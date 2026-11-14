import { z } from 'zod';
import type { IndiceEstruturaFinanceira, NoConta } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, exigirUmaLinha, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaParaTexto, lerCompetencia } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { ROTULO_TIPO_PROPOSTA, SITUACOES_VERSIONAVEIS, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import { competenciasDaVigencia, converterTexto, MODOS_RATEIO, replicarLinha, validarGrade, valorDoPercentual, type ModoRateio } from '../domain/rateio';
import { contaSob } from '../domain/viagem';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import type { OpcaoEstrutura } from './opcoes-estrutura';
import { executarPessoal, lerVersaoEditavel, travarVersao, uuid, type VersaoLida } from './pessoal-comum';
import { totaisDaVersao, vePessoal } from './totalizadores';

// Grade de Rateio/ISS da proposta de TP (US-073; UC03.03; plano do P24, Task 1). Uma grade por versão: a conta
// sintética mandante dá a base (o orçado dela nos Totalizadores, RN_RAT_06), e as células distribuem a taxa da
// Adm. Central (RN0270) em contas analíticas fora da mandante, por competência. O valor do ISS fica a definir
// (GAP-CAD-001). As peças de concorrência são as do P20: toda gravação sobe a versão da capa.

const FUNCIONALIDADE = 'orc.rateio';

export type LinhaRateio = { conta: string; descricao: string; celulas: Readonly<Record<string, { valor: Dinheiro; percentual: Percentual | null }>>; total: Dinheiro };

export type RateioTela = {
  propostaId: string;
  numero: string;
  objeto: string;
  tipo: TipoProposta;
  versaoNumero: number;
  situacao: SituacaoProposta;
  editavel: boolean;
  versaoCapa: number;
  competencias: readonly string[];
  /** Nula sem grade. */
  grade: { contaSintetica: string; descricaoSintetica: string; modo: ModoRateio; aliquotaIss: Percentual | null; linhas: readonly LinhaRateio[]; total: Dinheiro } | null;
  /** O orçado da mandante; nulo sem grade ou para quem não vê o pessoal (D-P24-2). */
  base: Dinheiro | null;
  baseRestrita: boolean;
  opcoes: { sinteticas: readonly OpcaoEstrutura[]; analiticas: readonly OpcaoEstrutura[] };
};

export type PropostaParaRateio = { id: string; numero: string; objeto: string; tipo: string };

const versao = z.coerce.number().int().min(0);
const entradaReplicar = z.object({ propostaId: z.string(), versaoCapa: versao, conta: z.string() }).strict();
const entradaExcluir = z.object({ propostaId: z.string(), versaoCapa: versao }).strict();
const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.RATEIO_DADOS_INVALIDOS }]);

const ultimaVersao = { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } as const;

function percorrer(arvore: readonly NoConta[], indice: IndiceEstruturaFinanceira) {
  const sinteticas: OpcaoEstrutura[] = [];
  const analiticas: OpcaoEstrutura[] = [];
  const descricoes = new Map<string, string>();
  const visitar = (nos: readonly NoConta[]) => {
    for (const n of nos) {
      descricoes.set(n.classificacao, n.descricao);
      if (n.tipo === 'SINTETICA' && n.ativa) sinteticas.push({ classificacao: n.classificacao, descricao: n.descricao });
      if (n.tipo === 'ANALITICA' && indice.contaAnaliticaAtiva(n.classificacao)) analiticas.push({ classificacao: n.classificacao, descricao: n.descricao });
      visitar(n.filhos);
    }
  };
  visitar(arvore);
  return { sinteticas, analiticas, descricoes };
}

/** RN_RAT_06 (D-P24-2): o orçado da mandante na versão, com o pessoal sempre (a trava precisa do valor real). */
async function baseDa(tx: TxCliente, deps: DepsOrc, versaoId: string, sintetica: string): Promise<Dinheiro> {
  const t = await totaisDaVersao(tx, deps, versaoId, true, { semRateio: true });
  return Dinheiro.somarTodos([...t.porConta].filter(([conta]) => contaSob(sintetica, conta)).map(([, v]) => v));
}

/** Sem proposta escolhida: as propostas do usuário (RLS), para escolher. */
export async function propostasParaRateio(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<readonly PropostaParaRateio[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const ps = await emUnidade(ctx, (tx) => tx.propostaTp.findMany({ where: { excluidaEm: null }, include: { unidade: { select: { codigo: true } } } }), { cliente: deps.cliente });
  return ps
    .map((p) => ({ id: p.id, numero: p.unidade.codigo, objeto: p.objeto, tipo: ROTULO_TIPO_PROPOSTA[p.tipo as TipoProposta] }))
    .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/** UC03.03: a grade da última versão da proposta; nula se o usuário não a vê. */
export async function obterRateio(ctx: ContextoRequisicao, propostaId: string, depsParciais: Partial<DepsOrc> = {}): Promise<RateioTela | null> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!uuid.safeParse(propostaId).success) return null;
  const [arvore, indice] = await Promise.all([deps.estruturaCompleta.listarArvoreContas(deps.cliente), deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente)]);
  const { sinteticas, analiticas, descricoes } = percorrer(arvore, indice);
  return emUnidade(
    ctx,
    async (tx) => {
      const p = await tx.propostaTp.findFirst({ where: { id: propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } }, versoes: ultimaVersao } });
      const v = p?.versoes[0];
      if (!p || !v) return null;
      const competencias = competenciasDaVigencia(p.inicio, p.fim);
      const g = await tx.rateioProposta.findUnique({ where: { versaoPropostaId: v.id }, include: { celulas: true } });
      let grade: RateioTela['grade'] = null;
      let base: Dinheiro | null = null;
      if (g) {
        const porConta = new Map<string, LinhaRateio['celulas']>();
        for (const c of g.celulas) {
          const atual = { ...(porConta.get(c.conta) ?? {}) };
          atual[competenciaParaTexto(c.competencia)] = { valor: Dinheiro.de(c.valor.toString()), percentual: c.percentual ? Percentual.dePontos(c.percentual.toString()) : null };
          porConta.set(c.conta, atual);
        }
        const linhas = [...porConta.entries()]
          .map(([conta, celulas]) => ({
            conta,
            descricao: descricoes.get(conta) ?? M.VIAGEM_CONTA_FORA_DO_PLANO,
            celulas,
            total: Dinheiro.somarTodos(Object.values(celulas).map((c) => c.valor)),
          }))
          .sort((a, b) => a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true }));
        grade = {
          contaSintetica: g.contaSintetica,
          descricaoSintetica: descricoes.get(g.contaSintetica) ?? M.VIAGEM_CONTA_FORA_DO_PLANO,
          modo: g.modo as ModoRateio,
          aliquotaIss: g.aliquotaIss ? Percentual.dePontos(g.aliquotaIss.toString()) : null,
          linhas,
          total: Dinheiro.somarTodos(linhas.map((l) => l.total)),
        };
        if (vePessoal(ctx)) base = await baseDa(tx, deps, v.id, g.contaSintetica);
      }
      return {
        propostaId: p.id,
        numero: p.unidade.codigo,
        objeto: p.objeto,
        tipo: p.tipo as TipoProposta,
        versaoNumero: v.numero,
        situacao: v.situacao as SituacaoProposta,
        editavel: (SITUACOES_VERSIONAVEIS as readonly string[]).includes(v.situacao),
        versaoCapa: p.versao,
        competencias,
        grade,
        base,
        baseRestrita: grade !== null && !vePessoal(ctx),
        opcoes: { sinteticas, analiticas },
      };
    },
    { cliente: deps.cliente },
  );
}

type Contexto = { lida: VersaoLida; tipo: TipoProposta; competencias: string[] };

async function contexto(tx: TxCliente, propostaId: string, versaoCapa: number): Promise<Resultado<Contexto>> {
  const lida = await lerVersaoEditavel(tx, propostaId, versaoCapa, M.RATEIO_VERSAO_IMUTAVEL);
  if (!lida.ok) return lida;
  const p = await tx.propostaTp.findUniqueOrThrow({ where: { id: propostaId }, select: { tipo: true, inicio: true, fim: true } });
  return ok({ lida: lida.valor, tipo: p.tipo as TipoProposta, competencias: competenciasDaVigencia(p.inicio, p.fim) });
}

/** RN_RAT_01 e D-P24-2: destinos analíticos ativos, fora da mandante (o rateio não entra na própria base). */
function conferirContas(indice: IndiceEstruturaFinanceira, sintetica: string, contas: Iterable<string>): Resultado<null> {
  for (const c of contas) {
    if (!indice.contaAnaliticaAtiva(c)) return falha([{ campo: '_', mensagem: `${M.RATEIO_CONTA_ANALITICA} (${c})` }]);
    if (contaSob(sintetica, c)) return falha([{ campo: '_', mensagem: M.RATEIO_CONTA_SOB_MANDANTE(c, sintetica) }]);
  }
  return ok(null);
}

const resumo = (g: { contaSintetica: string; modo: string; aliquotaIss: Percentual | null; total: Dinheiro; celulas: number }, tp: string, versaoProposta: number) => ({
  numeroTp: tp,
  versaoProposta,
  contaSintetica: g.contaSintetica,
  modo: g.modo,
  aliquotaIss: g.aliquotaIss?.paraString() ?? null,
  total: g.total.paraString(),
  celulas: g.celulas,
});

async function gravarCelulas(
  tx: TxCliente,
  rateioId: string,
  unidadeId: string,
  celulas: readonly { conta: string; competencia: string; valor: Dinheiro; percentual: Percentual | null }[],
) {
  await tx.rateioCelulaProposta.deleteMany({ where: { rateioId } });
  if (celulas.length === 0) return;
  await tx.rateioCelulaProposta.createMany({
    data: celulas.map((c) => ({
      unidadeId,
      rateioId,
      conta: c.conta,
      competencia: lerCompetencia(c.competencia)!,
      valor: c.valor.paraString(),
      percentual: c.percentual?.paraString() ?? null,
    })),
  });
}

/**
 * UC03.03, fluxo principal: salva a grade inteira (cria ou substitui). A troca de modo converte as células pela
 * base (REQ_RAT_002). E3 (base zero), E1 (soma acima da base) e E2 (alíquota) vêm antes da trava.
 */
export async function salvarRateio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  if (typeof bruto !== 'object' || bruto === null) return dadosInvalidos();
  const campos: Record<string, unknown> = bruto instanceof FormData ? Object.fromEntries(bruto.entries()) : { ...(bruto as Record<string, unknown>) };
  const propostaId = typeof campos.propostaId === 'string' ? campos.propostaId : '';
  const versaoCapa = versao.safeParse(campos.versaoCapa);
  if (!versaoCapa.success) return dadosInvalidos();
  const indice = await deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente);
  return executarPessoal(ctx, deps, async (tx) => {
    const c = await contexto(tx, propostaId, versaoCapa.data);
    if (!c.ok) return c;
    const { lida, tipo, competencias } = c.valor;
    const existente = await tx.rateioProposta.findUnique({ where: { versaoPropostaId: lida.versaoId } });
    exigir(ctx, FUNCIONALIDADE, existente ? 'alterar' : 'incluir');
    const sintetica = typeof campos.contaSintetica === 'string' ? campos.contaSintetica.trim() : '';
    if (sintetica !== '' && !indice.nosContas.some((n) => n.id === sintetica && n.tipo === 'SINTETICA'))
      return falha([{ campo: 'contaSintetica', mensagem: M.RATEIO_SINTETICA_INVALIDA }]);
    const base = sintetica === '' ? Dinheiro.zero() : await baseDa(tx, deps, lida.versaoId, sintetica);
    if (sintetica !== '' && base.ehZero()) return falha([{ campo: 'contaSintetica', mensagem: M.RATEIO_SEM_SALDO }]);
    // REQ_RAT_002: o texto das células foi digitado no modo anterior; converte para o novo pela base.
    const de = campos.modoAnterior;
    const para = campos.modo;
    if ((MODOS_RATEIO as readonly unknown[]).includes(de) && (MODOS_RATEIO as readonly unknown[]).includes(para) && de !== para) {
      for (const [k, v] of Object.entries(campos)) if (k.startsWith('c_') && typeof v === 'string') campos[k] = converterTexto(v, de as ModoRateio, para as ModoRateio, base);
    }
    const g = validarGrade(campos, { competencias, base, tipoProposta: tipo });
    if (!g.ok) return g;
    const contas = conferirContas(indice, g.valor.contaSintetica, new Set(g.valor.celulas.map((x) => x.conta)));
    if (!contas.ok) return contas;
    await travarVersao(tx, lida);

    const { unidadeId, numeroTp, versaoId, versaoNumero } = lida;
    const dados = { contaSintetica: g.valor.contaSintetica, modo: g.valor.modo, aliquotaIss: g.valor.aliquotaIss?.paraString() ?? null };
    let rateioId: string;
    if (existente) {
      exigirUmaLinha(await tx.rateioProposta.updateMany({ where: { id: existente.id, versao: existente.versao }, data: { ...dados, versao: { increment: 1 } } }));
      rateioId = existente.id;
    } else {
      rateioId = (await tx.rateioProposta.create({ data: { unidadeId, versaoPropostaId: versaoId, ...dados, criadoPor: ctx.usuarioId }, select: { id: true } })).id;
    }
    const anteriores = existente ? await tx.rateioCelulaProposta.findMany({ where: { rateioId } }) : [];
    await gravarCelulas(tx, rateioId, unidadeId, g.valor.celulas);
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: existente ? 'ALTERACAO' : 'INSERCAO',
      registroId: rateioId,
      descricao: `Grade de rateio ${existente ? 'alterada' : 'incluída'} na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      ...(existente
        ? {
            antes: resumo(
              {
                contaSintetica: existente.contaSintetica,
                modo: existente.modo,
                aliquotaIss: existente.aliquotaIss ? Percentual.dePontos(existente.aliquotaIss.toString()) : null,
                total: Dinheiro.somarTodos(anteriores.map((x) => Dinheiro.de(x.valor.toString()))),
                celulas: anteriores.length,
              },
              numeroTp,
              versaoNumero,
            ),
          }
        : {}),
      depois: resumo({ ...g.valor, celulas: g.valor.celulas.length }, numeroTp, versaoNumero),
    });
    return ok({ numero: numeroTp });
  });
}

/**
 * RN_RAT_03 e C1 da #95 (D-P24-5): na linha da conta, o primeiro mês preenchido vai aos meses zerados seguintes
 * (no modo %, o % e o valor pela base de agora); a soma passa pela trava E1.
 */
export async function replicarRateio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ conta: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  const parse = entradaReplicar.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { propostaId, versaoCapa, conta } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const c = await contexto(tx, propostaId, versaoCapa);
    if (!c.ok) return c;
    const { lida, competencias } = c.valor;
    const g = await tx.rateioProposta.findUnique({ where: { versaoPropostaId: lida.versaoId }, include: { celulas: true } });
    if (!g) return falha([{ campo: '_', mensagem: M.RATEIO_INEXISTENTE }]);
    const daLinha = new Map(g.celulas.filter((x) => x.conta === conta).map((x) => [competenciaParaTexto(x.competencia), x]));
    if (daLinha.size === 0) return dadosInvalidos();
    const base = await baseDa(tx, deps, lida.versaoId, g.contaSintetica);
    type Cel = { valor: Dinheiro; percentual: Percentual | null };
    const linha = replicarLinha<Cel>(
      competencias.map((comp) => {
        const x = daLinha.get(comp);
        return x ? { valor: Dinheiro.de(x.valor.toString()), percentual: x.percentual ? Percentual.dePontos(x.percentual.toString()) : null } : null;
      }),
    ).map((x, i) => (x && !daLinha.has(competencias[i]!) && x.percentual ? { ...x, valor: valorDoPercentual(base, x.percentual) } : x));
    const novas = linha.flatMap((x, i) => (x && !x.valor.ehZero() ? [{ conta, competencia: competencias[i]!, ...x }] : []));
    const outras = g.celulas
      .filter((x) => x.conta !== conta)
      .map((x) => ({
        conta: x.conta,
        competencia: competenciaParaTexto(x.competencia),
        valor: Dinheiro.de(x.valor.toString()),
        percentual: x.percentual ? Percentual.dePontos(x.percentual.toString()) : null,
      }));
    const todas = [...outras, ...novas];
    const total = Dinheiro.somarTodos(todas.map((x) => x.valor));
    if (total.comparar(base) > 0) return falha([{ campo: '_', mensagem: M.RATEIO_ESTOURO(total.formatar(), base.formatar()) }]);
    await travarVersao(tx, lida);

    exigirUmaLinha(await tx.rateioProposta.updateMany({ where: { id: g.id, versao: g.versao }, data: { versao: { increment: 1 } } }));
    await gravarCelulas(tx, g.id, lida.unidadeId, todas);
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: lida.unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: g.id,
      descricao: `Primeiro mês da conta ${conta} replicado na grade de rateio da versão ${lida.versaoNumero} da proposta do TP ${lida.numeroTp}`,
      antes: { conta, celulasDaConta: daLinha.size, total: Dinheiro.somarTodos(g.celulas.map((x) => Dinheiro.de(x.valor.toString()))).paraString() },
      depois: { conta, celulasDaConta: novas.length, total: total.paraString() },
    });
    return ok({ conta });
  });
}

/** Exclui a grade inteira da versão editável (as células vão junto). */
export async function excluirRateio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  return executarPessoal(ctx, deps, async (tx) => {
    const c = await contexto(tx, parse.data.propostaId, parse.data.versaoCapa);
    if (!c.ok) return c;
    const { lida } = c.valor;
    const g = await tx.rateioProposta.findUnique({ where: { versaoPropostaId: lida.versaoId }, include: { celulas: true } });
    if (!g) return falha([{ campo: '_', mensagem: M.RATEIO_INEXISTENTE }]);
    await travarVersao(tx, lida);

    exigirUmaLinha(await tx.rateioProposta.deleteMany({ where: { id: g.id, versao: g.versao } }));
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: lida.unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: g.id,
      descricao: `Grade de rateio excluída da versão ${lida.versaoNumero} da proposta do TP ${lida.numeroTp}`,
      antes: resumo(
        {
          contaSintetica: g.contaSintetica,
          modo: g.modo,
          aliquotaIss: g.aliquotaIss ? Percentual.dePontos(g.aliquotaIss.toString()) : null,
          total: Dinheiro.somarTodos(g.celulas.map((x) => Dinheiro.de(x.valor.toString()))),
          celulas: g.celulas.length,
        },
        lida.numeroTp,
        lida.versaoNumero,
      ),
    });
    return ok({ numero: lida.numeroTp });
  });
}

/**
 * RN_DUP_003 (D-P24-9): copia a grade e as células cuja competência cabe na vigência do destino. Na duplicação
 * com outro tipo, a alíquota de ISS não vem (o TP é imune; o Contrato precisa da sua).
 */
export async function copiarRateioDaVersao(tx: TxCliente, origemVersaoId: string, destinoVersaoId: string, criadoPor: string): Promise<void> {
  const g = await tx.rateioProposta.findUnique({ where: { versaoPropostaId: origemVersaoId }, include: { celulas: true } });
  if (!g) return;
  const capa = { select: { tipo: true, inicio: true, fim: true } } as const;
  const origem = await tx.versaoProposta.findUniqueOrThrow({ where: { id: origemVersaoId }, select: { proposta: capa } });
  const destino = await tx.versaoProposta.findUniqueOrThrow({ where: { id: destinoVersaoId }, select: { unidadeId: true, proposta: capa } });
  const cabem = new Set(competenciasDaVigencia(destino.proposta.inicio, destino.proposta.fim));
  const nova = await tx.rateioProposta.create({
    data: {
      unidadeId: destino.unidadeId,
      versaoPropostaId: destinoVersaoId,
      contaSintetica: g.contaSintetica,
      modo: g.modo,
      aliquotaIss: origem.proposta.tipo === destino.proposta.tipo ? g.aliquotaIss : null,
      criadoPor,
    },
    select: { id: true },
  });
  const celulas = g.celulas.filter((c) => cabem.has(competenciaParaTexto(c.competencia)));
  if (celulas.length > 0) {
    await tx.rateioCelulaProposta.createMany({
      data: celulas.map((c) => ({ unidadeId: destino.unidadeId, rateioId: nova.id, conta: c.conta, competencia: c.competencia, valor: c.valor, percentual: c.percentual })),
    });
  }
}
