import { lerPlanilhasSegura } from '@/modules/ger/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaParaTexto } from '../domain/empregado';
import { competenciasDaVigencia } from '../domain/rateio';
import {
  ABA_REALIZADO,
  COLUNAS_REALIZADO,
  competenciaDeLancamento,
  competenciaParaData,
  LINHA_CABECALHO_REALIZADO,
  lerCompetencia,
  validarArquivoRealizado,
  type ValorArquivo,
} from '../domain/realizado';
import { contextoAuditoria } from './calculo-linhas';
import { seriesDaVersao } from './cronograma';
import { resolverDeps, type DepsOrc } from './deps';
import { uuid } from './pessoal-comum';
import { vePessoal } from './totalizadores';

// Realizado por arquivo (US-085, parte 1; plano do P32, Tasks 2 e 3; OxR V2, RN_OXR_003 a 008). A carga é por TP, numa
// transação só (RN_OXR_005): competência aberta presente no arquivo é apagada e regravada; competência fechada não
// muda, e a diferença vira ajuste no primeiro mês aberto seguinte (RN_OXR_006, D-P32-5); conta desconhecida ou
// sintética vira pendência (RN_OXR_004, D-P32-6). Toda execução, aceita ou recusada, vai ao Histórico (RN_OXR_007).

export const FUNCIONALIDADE_REALIZADO = 'orc.realizado';
const FUNCIONALIDADE = FUNCIONALIDADE_REALIZADO;

// Travas da carga e do fechamento (pg_advisory_xact_lock): a carga trava o TP e divide a trava global com as outras
// cargas; o fechamento pega a global sozinho, para nenhuma carga ver a competência aberta e gravar depois de fechada.
const TRAVA_GLOBAL = 85_000;
const travarCarga = async (tx: TxCliente, unidadeId: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${TRAVA_GLOBAL})`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_GLOBAL + 1}, hashtext(${unidadeId}))`;
};
const travarFechamento = (tx: TxCliente) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_GLOBAL})`;
// A carga de um arquivo grande e o fechamento atrás das cargas em andamento passam dos 5 s padrão (revisão 12.12).
const PRAZO_MS = 60_000;

/** 'AAAA-MM' do mês corrente em Brasília (revisão 12.12): às 21h30 do dia 30/11 ainda é novembro. */
export function mesCorrente(agora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(agora);
  const de = (t: string) => partes.find((p) => p.type === t)!.value;
  return `${de('year')}-${de('month')}`;
}

export const MENSAGENS_CARGA = {
  TP_NAO_ENCONTRADO: 'Termo de Parceria não encontrado nos seus Termos de Parceria.',
  ARQUIVO_GRANDE: 'Arquivo maior que 1 MB.',
  COMPETENCIA_INVALIDA: 'Competência inválida. Use AAAA-MM.',
  COMPETENCIA_JA_FECHADA: 'Esta competência já está fechada.',
  COMPETENCIA_CORRENTE: 'Só é possível fechar competência anterior ao mês corrente.',
} as const;

export type ResumoCarga = {
  cargaId: string;
  numero: string;
  linhas: number;
  total: Dinheiro;
  /** Competências abertas regravadas (RN_OXR_005). */
  substituidas: readonly string[];
  /** Competências fechadas do arquivo, que não mudaram (RN_OXR_006). */
  fechadas: readonly string[];
  ajustes: number;
  pendencias: { quantidade: number; valor: Dinheiro };
};

export type DepsRealizado = DepsOrc & { lerPlanilhas: typeof lerPlanilhasSegura };

type TipoConta = 'ANALITICA' | 'SINTETICA';

async function tiposDasContas(deps: DepsOrc): Promise<Map<string, TipoConta>> {
  // Inclui as inativas: conta inativada (soft delete) continua recebendo realizado (RN_OXR_001).
  const arvore = await deps.estruturaCompleta.listarArvoreContas(deps.cliente, { incluirInativos: true });
  const tipos = new Map<string, TipoConta>();
  const visitar = (nos: typeof arvore) => nos.forEach((n) => (tipos.set(n.classificacao, n.tipo), visitar(n.filhos)));
  visitar(arvore);
  return tipos;
}

const chave = (conta: string, competencia: string) => `${conta}|${competencia}`;
const dec = (v: { toString(): string }) => Dinheiro.de(v.toString());

/** UC A1 do OxR V2 por arquivo (D-P32-1, D-P32-2): tudo ou nada. */
export async function carregarRealizado(
  ctx: ContextoRequisicao,
  entrada: { propostaId: string; arquivo: { nome: string; conteudo: Uint8Array } },
  depsParciais: Partial<DepsRealizado> = {},
): Promise<Resultado<ResumoCarga>> {
  const deps = resolverDeps(depsParciais);
  const lerPlanilhas = depsParciais.lerPlanilhas ?? lerPlanilhasSegura;
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const naoEncontrado = falha([{ campo: '_', mensagem: MENSAGENS_CARGA.TP_NAO_ENCONTRADO }]);
  if (!uuid.safeParse(entrada.propostaId).success) return naoEncontrado;
  const lido = await lerPlanilhas(entrada.arquivo, [
    { aba: ABA_REALIZADO, colunas: COLUNAS_REALIZADO, linhaCabecalhoMax: LINHA_CABECALHO_REALIZADO, colunasTexto: ['Conta'] },
  ]);
  const tipos = await tiposDasContas(deps);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({ where: { id: entrada.propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } } } });
      if (!p) {
        // RN_OXR_007: a recusa também fica no Histórico (revisão 12.12), sem dizer se o TP existe.
        await auditar(tx, {
          contexto: contextoAuditoria(ctx),
          funcionalidade: FUNCIONALIDADE,
          tipo: 'SISTEMA',
          descricao: `Carga do realizado recusada: TP não encontrado (arquivo ${entrada.arquivo.nome})`,
          depois: { status: 'RECUSADA', propostaId: entrada.propostaId },
        });
        return naoEncontrado;
      }
      const contexto = { ...contextoAuditoria(ctx), unidadeId: p.unidadeId };
      const recusar = async (r: Resultado<never>) => {
        await auditar(tx, {
          contexto,
          funcionalidade: FUNCIONALIDADE,
          tipo: 'SISTEMA',
          descricao: `Carga do realizado do TP ${p.unidade.codigo} recusada (arquivo ${entrada.arquivo.nome})`,
          depois: { status: 'RECUSADA', erros: r.ok ? 0 : r.erros.length },
        });
        return r;
      };
      if (!lido.ok) return recusar(falha(lido.erros));
      const planilha = lido.valor[0]!;
      if (planilha.errosCelula.length > 0) {
        return recusar(falha(planilha.errosCelula.map((e) => ({ campo: `linhas.${e.linha}.${e.coluna ?? '_'}`, mensagem: `Linha ${e.linha}: ${e.mensagem}` }))));
      }
      const validado = validarArquivoRealizado(planilha.linhas, new Set(competenciasDaVigencia(p.inicio, p.fim)));
      if (!validado.ok) return recusar(validado);

      await travarCarga(tx, p.unidadeId);
      const fechadas = new Set((await tx.competenciaFechada.findMany({ select: { competencia: true } })).map((c) => competenciaParaTexto(c.competencia)));
      const presentes = [...new Set(validado.valor.map((v) => v.competencia))].sort();
      const abertas = presentes.filter((c) => !fechadas.has(c));
      const fechadasNoArquivo = presentes.filter((c) => fechadas.has(c));

      const analiticas: ValorArquivo[] = [];
      const doArquivo: (ValorArquivo & { motivo: 'CONTA_DESCONHECIDA' | 'CONTA_SINTETICA' })[] = [];
      for (const v of validado.valor) {
        const tipo = tipos.get(v.conta);
        if (tipo === 'ANALITICA') analiticas.push(v);
        else doArquivo.push({ ...v, motivo: tipo === 'SINTETICA' ? 'CONTA_SINTETICA' : 'CONTA_DESCONHECIDA' });
      }
      // Pendência de competência fechada não muda (RN_OXR_006, revisão 12.12): entra só a diferença para o que já está
      // pendente daquela conta do ERP e competência; a recarga igual não gera pendência nova.
      const pendentesFechadas = await tx.pendenciaRealizado.findMany({
        where: { unidadeId: p.unidadeId, competencia: { in: presentes.filter((c) => fechadas.has(c)).map(competenciaParaData) } },
      });
      const jaPendente = new Map<string, Dinheiro>();
      for (const x of pendentesFechadas) {
        const k = chave(x.contaErp, competenciaParaTexto(x.competencia));
        jaPendente.set(k, (jaPendente.get(k) ?? Dinheiro.zero()).somar(dec(x.valor)));
      }
      const pendentes = doArquivo.flatMap((v) => {
        if (!fechadas.has(v.competencia)) return [v];
        const diferenca = v.valor.subtrair(jaPendente.get(chave(v.conta, v.competencia)) ?? Dinheiro.zero());
        return diferenca.ehZero() ? [] : [{ ...v, valor: diferenca }];
      });

      // RN_OXR_006, D-P32-5: diferença da competência fechada contra o que o SGO já tem dela (carga + ajustes com essa
      // origem). Conta que o SGO tem e o arquivo não traz vale zero no arquivo, como na substituição do mês aberto.
      const ajustes: { conta: string; origem: string; lancamento: string; valor: Dinheiro }[] = [];
      if (fechadasNoArquivo.length > 0) {
        const datas = fechadasNoArquivo.map(competenciaParaData);
        const [gravados, jaAjustados] = await Promise.all([
          tx.realizadoContaMes.findMany({ where: { unidadeId: p.unidadeId, competencia: { in: datas } } }),
          tx.ajusteRealizado.findMany({ where: { unidadeId: p.unidadeId, competenciaOrigem: { in: datas } } }),
        ]);
        const noSgo = new Map<string, Dinheiro>();
        const somar = (k: string, v: Dinheiro) => noSgo.set(k, (noSgo.get(k) ?? Dinheiro.zero()).somar(v));
        for (const g of gravados) somar(chave(g.conta, competenciaParaTexto(g.competencia)), dec(g.valor));
        for (const a of jaAjustados) somar(chave(a.conta, competenciaParaTexto(a.competenciaOrigem)), dec(a.valor));
        const noArquivo = new Map(analiticas.filter((v) => fechadas.has(v.competencia)).map((v) => [chave(v.conta, v.competencia), v.valor]));
        for (const k of new Set([...noSgo.keys(), ...noArquivo.keys()])) {
          const diferenca = (noArquivo.get(k) ?? Dinheiro.zero()).subtrair(noSgo.get(k) ?? Dinheiro.zero());
          if (diferenca.ehZero()) continue;
          const [conta, origem] = k.split('|') as [string, string];
          ajustes.push({ conta, origem, lancamento: competenciaDeLancamento(origem, fechadas), valor: diferenca });
        }
      }

      const total = Dinheiro.somarTodos(validado.valor.map((v) => v.valor));
      const valorPendente = Dinheiro.somarTodos(pendentes.map((v) => v.valor));
      const carga = await tx.cargaRealizado.create({
        data: {
          unidadeId: p.unidadeId,
          arquivo: entrada.arquivo.nome.slice(0, 200),
          linhas: validado.valor.length,
          total: total.paraDecimal(),
          pendencias: pendentes.length,
          ajustes: ajustes.length,
          competencias: presentes,
          carregadoPor: ctx.usuarioId,
        },
        select: { id: true },
      });
      // D-P32-3: as pendências e o realizado das competências abertas do arquivo são substituídos.
      await tx.pendenciaRealizado.deleteMany({ where: { unidadeId: p.unidadeId, competencia: { in: abertas.map(competenciaParaData) } } });
      // Nas fechadas, a pendência cuja conta já é analítica foi absorvida pelo ajuste acima (o arquivo manda no mês): sai,
      // para o reprocessamento não a lançar de novo (revisão 12.12 da parte 2).
      const absorvidas = pendentesFechadas.filter((x) => tipos.get(x.contaErp) === 'ANALITICA').map((x) => x.id);
      if (absorvidas.length > 0) await tx.pendenciaRealizado.deleteMany({ where: { id: { in: absorvidas } } });
      await tx.realizadoContaMes.deleteMany({ where: { unidadeId: p.unidadeId, competencia: { in: abertas.map(competenciaParaData) } } });
      await tx.realizadoContaMes.createMany({
        data: analiticas
          .filter((v) => !fechadas.has(v.competencia))
          .map((v) => ({ unidadeId: p.unidadeId, conta: v.conta, competencia: competenciaParaData(v.competencia), valor: v.valor.paraDecimal(), cargaId: carga.id })),
      });
      await tx.ajusteRealizado.createMany({
        data: ajustes.map((a) => ({
          unidadeId: p.unidadeId,
          conta: a.conta,
          competenciaOrigem: competenciaParaData(a.origem),
          competenciaLancamento: competenciaParaData(a.lancamento),
          valor: a.valor.paraDecimal(),
          cargaId: carga.id,
        })),
      });
      await tx.pendenciaRealizado.createMany({
        data: pendentes.map((v) => ({
          unidadeId: p.unidadeId,
          contaErp: v.conta.slice(0, 100),
          competencia: competenciaParaData(v.competencia),
          valor: v.valor.paraDecimal(),
          motivo: v.motivo,
          cargaId: carga.id,
        })),
      });
      await auditar(tx, {
        contexto,
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: carga.id,
        descricao: `Carga do realizado do TP ${p.unidade.codigo} (arquivo ${entrada.arquivo.nome})`,
        depois: {
          status: 'CONCLUIDA',
          linhas: validado.valor.length,
          total: total.paraString(),
          substituidas: abertas,
          fechadas: fechadasNoArquivo,
          ajustes: ajustes.length,
          pendencias: pendentes.length,
          valorPendente: valorPendente.paraString(),
        },
      });
      return ok({
        cargaId: carga.id,
        numero: p.unidade.codigo,
        linhas: validado.valor.length,
        total,
        substituidas: abertas,
        fechadas: fechadasNoArquivo,
        ajustes: ajustes.length,
        pendencias: { quantidade: pendentes.length, valor: valorPendente },
      });
    },
    { cliente: deps.cliente, timeoutMs: PRAZO_MS },
  );
}

/** D-P32-4 [PROVISÓRIO]: fecha a competência para todos os TPs; só competência anterior ao mês corrente; sem reabertura. */
export async function fecharCompetencia(ctx: ContextoRequisicao, entrada: { competencia: string }, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ competencia: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'aprovar');
  const competencia = /^\d{4}-\d{2}$/.test(entrada.competencia) ? lerCompetencia(entrada.competencia) : null;
  if (!competencia) return falha([{ campo: 'competencia', mensagem: MENSAGENS_CARGA.COMPETENCIA_INVALIDA }]);
  if (competencia >= mesCorrente(deps.agora())) return falha([{ campo: 'competencia', mensagem: MENSAGENS_CARGA.COMPETENCIA_CORRENTE }]);
  return emUnidade(
    ctx,
    async (tx) => {
      await travarFechamento(tx);
      const data = competenciaParaData(competencia);
      if (await tx.competenciaFechada.findUnique({ where: { competencia: data } })) return falha([{ campo: 'competencia', mensagem: MENSAGENS_CARGA.COMPETENCIA_JA_FECHADA }]);
      await tx.competenciaFechada.create({ data: { competencia: data, fechadaPor: ctx.usuarioId } });
      await auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: competencia,
        descricao: `Competência ${competencia} fechada para o realizado`,
        depois: { competencia, situacao: 'FECHADA' },
      });
      return ok({ competencia });
    },
    { cliente: deps.cliente, timeoutMs: PRAZO_MS },
  );
}

export type ResumoReprocessamento = { numero: string; resolvidas: number; restantes: number; ajustes: number };

/**
 * Reprocessa as pendências do TP depois da Integração 1 (RN_OXR_004: "até a Integração 1 ser executada"; US-085,
 * parte 2; D-P32-12) [PROVISÓRIO]: a pendência cuja conta passou a ser analítica no C1 sai da lista; em mês aberto, o
 * valor soma ao realizado da conta (a linha é apagada e regravada, sem UPDATE); em mês fechado, vira ajuste no primeiro
 * mês aberto seguinte, com a origem (RN_OXR_006). As demais ficam. Tudo numa transação, com a trava da carga.
 */
export async function reprocessarPendencias(ctx: ContextoRequisicao, entrada: { propostaId: string }, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<ResumoReprocessamento>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const naoEncontrado = falha([{ campo: '_', mensagem: MENSAGENS_CARGA.TP_NAO_ENCONTRADO }]);
  if (!uuid.safeParse(entrada.propostaId).success) return naoEncontrado;
  const tipos = await tiposDasContas(deps);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({ where: { id: entrada.propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } } } });
      if (!p) return naoEncontrado;
      await travarCarga(tx, p.unidadeId);
      const fechadas = new Set((await tx.competenciaFechada.findMany({ select: { competencia: true } })).map((c) => competenciaParaTexto(c.competencia)));
      const pendentes = await tx.pendenciaRealizado.findMany({ where: { unidadeId: p.unidadeId } });
      const resolvidas = pendentes.filter((x) => tipos.get(x.contaErp) === 'ANALITICA');
      if (resolvidas.length === 0) return ok({ numero: p.unidade.codigo, resolvidas: 0, restantes: pendentes.length, ajustes: 0 });

      const abertas = new Map<string, Dinheiro>();
      const ajustes = new Map<string, Dinheiro>();
      const somar = (m: Map<string, Dinheiro>, k: string, v: Dinheiro) => m.set(k, (m.get(k) ?? Dinheiro.zero()).somar(v));
      for (const x of resolvidas) {
        const c = competenciaParaTexto(x.competencia);
        somar(fechadas.has(c) ? ajustes : abertas, chave(x.contaErp, c), dec(x.valor));
      }
      const listaAjustes = [...ajustes.entries()].filter(([, v]) => !v.ehZero());
      const carga = await tx.cargaRealizado.create({
        data: {
          unidadeId: p.unidadeId,
          arquivo: '(reprocessamento de pendências)',
          linhas: resolvidas.length,
          total: Dinheiro.somarTodos(resolvidas.map((x) => dec(x.valor))).paraDecimal(),
          pendencias: pendentes.length - resolvidas.length,
          ajustes: listaAjustes.length,
          competencias: [...new Set(resolvidas.map((x) => competenciaParaTexto(x.competencia)))].sort(),
          carregadoPor: ctx.usuarioId,
        },
        select: { id: true },
      });
      for (const [k, valor] of abertas) {
        if (valor.ehZero()) continue;
        const [conta, c] = k.split('|') as [string, string];
        const competencia = competenciaParaData(c);
        const atual = await tx.realizadoContaMes.findUnique({ where: { unidadeId_conta_competencia: { unidadeId: p.unidadeId, conta, competencia } } });
        if (atual) await tx.realizadoContaMes.delete({ where: { id: atual.id } });
        const total = atual ? dec(atual.valor).somar(valor) : valor;
        await tx.realizadoContaMes.create({ data: { unidadeId: p.unidadeId, conta, competencia, valor: total.paraDecimal(), cargaId: carga.id } });
      }
      await tx.ajusteRealizado.createMany({
        data: listaAjustes.map(([k, valor]) => {
          const [conta, origem] = k.split('|') as [string, string];
          return { unidadeId: p.unidadeId, conta, competenciaOrigem: competenciaParaData(origem), competenciaLancamento: competenciaParaData(competenciaDeLancamento(origem, fechadas)), valor: valor.paraDecimal(), cargaId: carga.id };
        }),
      });
      await tx.pendenciaRealizado.deleteMany({ where: { id: { in: resolvidas.map((x) => x.id) } } });
      await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: carga.id,
        descricao: `Pendências do realizado do TP ${p.unidade.codigo} reprocessadas`,
        depois: { status: 'CONCLUIDA', resolvidas: resolvidas.length, restantes: pendentes.length - resolvidas.length, ajustes: listaAjustes.length },
      });
      return ok({ numero: p.unidade.codigo, resolvidas: resolvidas.length, restantes: pendentes.length - resolvidas.length, ajustes: listaAjustes.length });
    },
    { cliente: deps.cliente, timeoutMs: PRAZO_MS },
  );
}

/** O realizado de cada unidade (carga + ajustes de todas as competências), para o Consolidado (D-P32-8). */
export async function realizadoPorUnidade(tx: TxCliente, unidadeIds: readonly string[]): Promise<Map<string, Dinheiro>> {
  const [cargas, ajustes] = await Promise.all([
    tx.realizadoContaMes.groupBy({ by: ['unidadeId'], where: { unidadeId: { in: [...unidadeIds] } }, _sum: { valor: true } }),
    tx.ajusteRealizado.groupBy({ by: ['unidadeId'], where: { unidadeId: { in: [...unidadeIds] } }, _sum: { valor: true } }),
  ]);
  const r = new Map<string, Dinheiro>();
  for (const g of [...cargas, ...ajustes]) {
    if (g._sum.valor) r.set(g.unidadeId, (r.get(g.unidadeId) ?? Dinheiro.zero()).somar(dec(g._sum.valor)));
  }
  return r;
}

// ---------- Leitura ----------

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export type LinhaRealizado = { conta: string; competencia: string; valor: Dinheiro };
export type AjusteDoRealizado = { conta: string; origem: string; lancamento: string; valor: Dinheiro };
export type RealizadoDoTp = {
  /** Só analíticas; o valor do mês é a carga mais os ajustes lançados nele (RN_OXR_008). Sintéticas: `totalizar` (RN_OXR_009). */
  linhas: readonly LinhaRealizado[];
  /** Os ajustes lançados no período, com a origem (RN_OXR_006). */
  ajustes: readonly AjusteDoRealizado[];
  /** As pendências das competências do período (RN_OXR_004, E3). */
  pendencias: { quantidade: number; valor: Dinheiro };
  /** A última carga do TP (REQ_OXR_005); nulo se nunca houve. */
  atualizadoEm: Date | null;
  /**
   * Só com `previsto: true` no filtro (US-085, parte 2; D-P32-10): o cronograma de desembolso da última versão
   * oficializada (UC04.01), por conta analítica e competência do período. Vazio se não há versão oficializada.
   */
  previsto?: readonly LinhaRealizado[];
  /** O número da versão oficializada do previsto; nulo se não há (D-P32-10). */
  versaoPrevisto?: number | null;
  /** Há pessoal homologado fora do previsto: só quem lança os empregados vê o custo do pessoal (D-P23-5, D-P32-11). */
  previstoSemPessoal?: boolean;
  /** Há empregados na versão oficial, mas o lote de pessoal não foi homologado: o pessoal não entra (RN_WA05_005). */
  pessoalNaoHomologado?: boolean;
  /** O cabeçalho do TP (pedido da frente B na #138; RN0238, RN0294). */
  tp?: TpDoRealizado;
};

/** A capa do TP e a última versão oficializada, sem recalcular nada (pedido da frente B na #138). */
export type TpDoRealizado = { numero: string; objeto: string; inicio: string; fim: string; versaoOficial: number | null };

const capaDoTp = (p: { objeto: string; inicio: Date; fim: Date; unidade: { codigo: string }; versoes: readonly { numero: number }[] }): TpDoRealizado => ({
  numero: p.unidade.codigo,
  objeto: p.objeto,
  inicio: competenciaParaTexto(p.inicio),
  fim: competenciaParaTexto(p.fim),
  versaoOficial: p.versoes[0]?.numero ?? null,
});
const VERSAO_OFICIAL = { where: { snapshot: { isNot: null } }, orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true } } as const;

/** Os TPs que o usuário vê (RLS), para o filtro dos relatórios de execução (RN0234; RN0385 filtra pelo versaoOficial). */
export async function tpsDoRealizado(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly TpDoRealizado[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const ps = await emUnidade(
    ctx,
    (tx) => tx.propostaTp.findMany({ where: { excluidaEm: null }, select: { objeto: true, inicio: true, fim: true, unidade: { select: { codigo: true } }, versoes: VERSAO_OFICIAL } }),
    { cliente: deps.cliente },
  );
  return ps.map(capaDoTp).sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

export async function lerRealizado(tx: TxCliente, unidadeId: string, de?: string, ate?: string): Promise<RealizadoDoTp & { pendentes: readonly LinhaRealizado[] }> {
  const periodo = de && ate ? { gte: competenciaParaData(de), lte: competenciaParaData(ate) } : undefined;
  const [cargas, ajustes, pendentes, ultima] = await Promise.all([
    tx.realizadoContaMes.findMany({ where: { unidadeId, ...(periodo && { competencia: periodo }) } }),
    tx.ajusteRealizado.findMany({ where: { unidadeId, ...(periodo && { competenciaLancamento: periodo }) }, orderBy: [{ competenciaLancamento: 'asc' }, { conta: 'asc' }] }),
    tx.pendenciaRealizado.findMany({ where: { unidadeId, ...(periodo && { competencia: periodo }) }, orderBy: [{ competencia: 'asc' }, { contaErp: 'asc' }] }),
    tx.cargaRealizado.findFirst({ where: { unidadeId }, orderBy: { carregadoEm: 'desc' }, select: { carregadoEm: true } }),
  ]);
  const porChave = new Map<string, LinhaRealizado>();
  const lancar = (conta: string, competencia: string, valor: Dinheiro) => {
    const k = chave(conta, competencia);
    porChave.set(k, { conta, competencia, valor: (porChave.get(k)?.valor ?? Dinheiro.zero()).somar(valor) });
  };
  for (const c of cargas) lancar(c.conta, competenciaParaTexto(c.competencia), dec(c.valor));
  const listaAjustes = ajustes.map((a) => ({ conta: a.conta, origem: competenciaParaTexto(a.competenciaOrigem), lancamento: competenciaParaTexto(a.competenciaLancamento), valor: dec(a.valor) }));
  for (const a of listaAjustes) lancar(a.conta, a.lancamento, a.valor);
  const listaPendentes = pendentes.map((x) => ({ conta: x.contaErp, competencia: competenciaParaTexto(x.competencia), valor: dec(x.valor) }));
  return {
    linhas: [...porChave.values()].sort((a, b) => a.competencia.localeCompare(b.competencia) || a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true })),
    ajustes: listaAjustes,
    pendencias: { quantidade: listaPendentes.length, valor: Dinheiro.somarTodos(listaPendentes.map((x) => x.valor)) },
    pendentes: listaPendentes,
    atualizadoEm: ultima?.carregadoEm ?? null,
  };
}

/**
 * Porta pública do realizado (pedido da frente B na #138): leitura, com a RLS do usuário e `orc.realizado:consultar`.
 * `tp` é o número do TP; `de` e `ate` são 'AAAA-MM'. Nulo se o TP não existe ou o usuário não o vê.
 */
export async function realizadoPorTp(
  ctx: ContextoRequisicao,
  filtro: { tp: string; de: string; ate: string; previsto?: boolean },
  depsParciais: Partial<DepsOrc> = {},
): Promise<RealizadoDoTp | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!COMPETENCIA.test(filtro.de) || !COMPETENCIA.test(filtro.ate) || filtro.de > filtro.ate) return null;
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({
        where: { excluidaEm: null, unidade: { codigo: filtro.tp } },
        select: { unidadeId: true, objeto: true, inicio: true, fim: true, unidade: { select: { codigo: true } }, versoes: VERSAO_OFICIAL },
      });
      if (!p) return null;
      const r = await lerRealizado(tx, p.unidadeId, filtro.de, filtro.ate);
      const base = { linhas: r.linhas, ajustes: r.ajustes, pendencias: r.pendencias, atualizadoEm: r.atualizadoEm, tp: capaDoTp(p) };
      if (!filtro.previsto) return base;
      const oficial = p.versoes[0];
      const comPessoal = vePessoal(ctx);
      if (!oficial) return { ...base, previsto: [], versaoPrevisto: null, previstoSemPessoal: false, pessoalNaoHomologado: false };
      const competencias = competenciasDaVigencia(p.inicio, p.fim);
      const s = await seriesDaVersao(tx, deps, oficial.id, comPessoal, competencias);
      const previsto = [...s.porContaMes.entries()]
        .map(([k, valor]) => {
          const [conta, competencia] = k.split('|') as [string, string];
          return { conta, competencia, valor };
        })
        .filter((l) => l.competencia >= filtro.de && l.competencia <= filtro.ate)
        .sort((a, b) => a.competencia.localeCompare(b.competencia) || a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true }));
      return { ...base, previsto, versaoPrevisto: oficial.numero, previstoSemPessoal: s.semPessoal, pessoalNaoHomologado: s.pessoalNaoHomologado };
    },
    { cliente: deps.cliente },
  );
}

export type CompetenciaTela = { competencia: string; fechada: boolean; valor: Dinheiro };
export type CargaTela = { arquivo: string; carregadoEm: Date; linhas: number; total: Dinheiro; ajustes: number; pendencias: number };
export type TelaRealizado = {
  propostaId: string;
  numero: string;
  objeto: string;
  competencias: readonly CompetenciaTela[];
  ajustes: readonly AjusteDoRealizado[];
  pendentes: readonly LinhaRealizado[];
  pendencias: { quantidade: number; valor: Dinheiro };
  cargas: readonly CargaTela[];
  atualizadoEm: Date | null;
  total: Dinheiro;
};
export type PropostaParaRealizado = { id: string; numero: string; objeto: string };

/** As propostas do usuário (RLS), para escolher. */
export async function propostasParaRealizado(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly PropostaParaRealizado[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const ps = await emUnidade(ctx, (tx) => tx.propostaTp.findMany({ where: { excluidaEm: null }, include: { unidade: { select: { codigo: true } } } }), { cliente: deps.cliente });
  return ps.map((p) => ({ id: p.id, numero: p.unidade.codigo, objeto: p.objeto })).sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/** A tela do realizado do TP: o valor por competência da vigência, os ajustes, as pendências e as últimas cargas. */
export async function obterTelaRealizado(ctx: ContextoRequisicao, propostaId: string, depsParciais: Partial<DepsOrc> = {}): Promise<TelaRealizado | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!uuid.safeParse(propostaId).success) return null;
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({ where: { id: propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } } } });
      if (!p) return null;
      const [r, fechadas, cargas] = await Promise.all([
        lerRealizado(tx, p.unidadeId),
        tx.competenciaFechada.findMany({ select: { competencia: true } }),
        tx.cargaRealizado.findMany({ where: { unidadeId: p.unidadeId }, orderBy: { carregadoEm: 'desc' }, take: 10 }),
      ]);
      const fechada = new Set(fechadas.map((f) => competenciaParaTexto(f.competencia)));
      const porMes = new Map<string, Dinheiro>();
      for (const l of r.linhas) porMes.set(l.competencia, (porMes.get(l.competencia) ?? Dinheiro.zero()).somar(l.valor));
      // A vigência e as competências fora dela com valor (ajuste lançado depois do fim).
      const meses = [...new Set([...competenciasDaVigencia(p.inicio, p.fim), ...porMes.keys()])].sort();
      return {
        propostaId: p.id,
        numero: p.unidade.codigo,
        objeto: p.objeto,
        competencias: meses.map((c) => ({ competencia: c, fechada: fechada.has(c), valor: porMes.get(c) ?? Dinheiro.zero() })),
        ajustes: r.ajustes,
        pendentes: r.pendentes,
        pendencias: r.pendencias,
        cargas: cargas.map((c) => ({ arquivo: c.arquivo, carregadoEm: c.carregadoEm, linhas: c.linhas, total: dec(c.total), ajustes: c.ajustes, pendencias: c.pendencias })),
        atualizadoEm: r.atualizadoEm,
        total: Dinheiro.somarTodos([...porMes.values()]),
      };
    },
    { cliente: deps.cliente },
  );
}
