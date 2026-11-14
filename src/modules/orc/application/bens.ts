import { z } from 'zod';
import type { IndiceEstruturaFinanceira, NoConta } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { agruparPorConta, dataParaTexto, totalDoBem, validarBem, type BemValidado } from '../domain/bem';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { lerDataCivil } from '../domain/proposta';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';
import type { OpcaoEstrutura } from './opcoes-estrutura';
import {
  cabecalho,
  contem,
  executarPessoal,
  lerVersaoEditavel,
  metasDaVersao,
  resolverMeta,
  tipoDoFiltro,
  travarVersao,
  uuid,
  type CabecalhoBloco,
  type FiltrosPessoal,
  type VersaoLida,
} from './pessoal-comum';

// Bens, serviços e equipamentos (CAPEX) da proposta de TP (US-072; UC03.34 a UC03.37; plano do P22, Task 1). O
// bem é da versão, na meta (categoria Meta) ou sem ela (Consolidada), numa conta analítica ativa (do grupo CAPEX
// quando o cad expuser a natureza, D-P22-3). O valor total é calculado na leitura (RN0157). O bem copiado de
// versão anterior é inativado em vez de apagado (RN_PLA_11, D-P22-6). As peças de concorrência são as do P20.

const FUNCIONALIDADE = 'orc.bens';

export type FiltrosBens = FiltrosPessoal & {
  descricao?: string | undefined;
  conta?: string | undefined;
  /** "AAAA-MM-DD"; vazio é a vigência (RN0294). */
  inicio?: string | undefined;
  fim?: string | undefined;
  /** Padrão: sim (RN0383). */
  exibirZerados?: boolean | undefined;
  exibirInativos?: boolean | undefined;
};

export type BemTela = {
  id: string;
  metaId: string | null;
  /** Número e nome da meta, na categoria Meta. */
  meta: string | null;
  conta: string;
  descricao: string;
  /** "AAAA-MM-DD". */
  data: string;
  quantidade: number;
  valorUnitario: Dinheiro;
  valorTotal: Dinheiro;
  ativo: boolean;
  /** Veio de uma versão anterior: a exclusão inativa (D-P22-6). */
  copiado: boolean;
  versao: number;
};

export type GrupoBens = { conta: string; descricaoConta: string; itens: readonly BemTela[]; subtotal: Dinheiro };

export type BlocoBens = CabecalhoBloco & {
  /** Por conta analítica, em ordem crescente (RN0417), com o subtotal (RN0415). */
  grupos: readonly GrupoBens[];
  /** Total geral (RN0413). */
  total: Dinheiro;
  /** Inativos da versão (fora dos grupos, salvo com o filtro). */
  inativos: number;
  /** Os inativos, com o filtro "Exibir inativos". */
  listaInativos: readonly BemTela[];
};

export type OpcoesBem = {
  contas: readonly OpcaoEstrutura[];
  /** Nenhuma conta do plano tem a natureza CAPEX ainda: a lista traz todas as analíticas ativas. */
  semCapex: boolean;
};

const versao = z.coerce.number().int().min(0);
const texto = z.string().optional();
const camposBem = { conta: texto, descricao: texto, data: texto, quantidade: texto, valorUnitario: texto };
const entradaIncluir = z.object({ propostaId: z.string(), versaoCapa: versao, metaId: texto, ...camposBem }).strict();
const entradaAlterar = z.object({ id: z.string(), versao, versaoCapa: versao, metaId: texto, ...camposBem }).strict();
const entradaExcluir = z.object({ id: z.string(), versao, versaoCapa: versao }).strict();

const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.BEM_DADOS_INVALIDOS }]);
const inexistente = () => falha([{ campo: '_', mensagem: M.BEM_INEXISTENTE }]);

// O que vai ao Histórico (RN0232): o bem como o usuário o vê, com o total calculado.
const retrato = (b: BemValidado, tp: string, versaoProposta: number, meta: string | null) => ({
  numeroTp: tp,
  versaoProposta,
  meta,
  conta: b.conta,
  descricao: b.descricao,
  data: dataParaTexto(b.data),
  quantidade: b.quantidade,
  valorUnitario: b.valorUnitario.paraString(),
  valorTotal: totalDoBem(b).paraString(),
});

type BemGravado = { conta: string; descricao: string; data: Date; quantidade: number; valorUnitario: { toString(): string } };
const paraValidado = (b: BemGravado): BemValidado => ({
  conta: b.conta,
  descricao: b.descricao,
  data: b.data,
  quantidade: b.quantidade,
  valorUnitario: Dinheiro.de(b.valorUnitario.toString()),
});

const dadosGravados = (b: BemValidado, metaId: string | null) => ({
  metaId,
  conta: b.conta,
  descricao: b.descricao,
  data: b.data,
  quantidade: b.quantidade,
  valorUnitario: b.valorUnitario.paraString(),
});

function analiticas(arvore: readonly NoConta[], indice: IndiceEstruturaFinanceira, capex: ((c: string) => boolean) | undefined): OpcaoEstrutura[] {
  return arvore.flatMap((n) => [
    ...(n.tipo === 'ANALITICA' && indice.contaAnaliticaAtiva(n.classificacao) && (!capex || capex(n.classificacao))
      ? [{ classificacao: n.classificacao, descricao: n.descricao }]
      : []),
    ...analiticas(n.filhos, indice, capex),
  ]);
}

/**
 * RN0411 e RN0419 (D-P22-3): o grupo Imobilizado e Intangível é a natureza CAPEX do parâmetro local da conta
 * (C27), exposta pelo C1 desde o #473 da frente B. Enquanto a GFIN não marcar nenhuma conta como CAPEX, não há
 * filtro: valem todas as analíticas ativas, com o aviso na tela [PROVISÓRIO]. O `contaCapex` das deps substitui
 * o do C1 nos testes.
 */
function filtroCapex(indice: IndiceEstruturaFinanceira, deps: DepsOrc): ((conta: string) => boolean) | undefined {
  if (deps.contaCapex) return deps.contaCapex;
  const algumaCapex = indice.nosContas.some((n) => n.tipo === 'ANALITICA' && indice.contaAnaliticaCapex(n.id));
  return algumaCapex ? (conta) => indice.contaAnaliticaCapex(conta) : undefined;
}

/** As contas do formulário (RN0411, RN0419): analíticas ativas do grupo CAPEX, ou todas enquanto não houver. */
export async function opcoesBem(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<OpcoesBem> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const deps = resolverDeps(depsParciais);
  const [arvore, indice] = await Promise.all([deps.estruturaCompleta.listarArvoreContas(deps.cliente), deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente)]);
  const capex = filtroCapex(indice, deps);
  return { contas: analiticas(arvore, indice, capex), semCapex: capex === undefined };
}

/** RN0411 e RN0419 (D-P22-3): analítica ativa e, havendo contas CAPEX no plano, do grupo CAPEX. */
function conferirConta(indice: IndiceEstruturaFinanceira, deps: DepsOrc, conta: string): Resultado<null> {
  if (!indice.contaAnaliticaAtiva(conta)) return falha([{ campo: 'conta', mensagem: M.BEM_CONTA_ANALITICA }]);
  const capex = filtroCapex(indice, deps);
  if (capex && !capex(conta)) return falha([{ campo: 'conta', mensagem: M.BEM_CONTA_NAO_CAPEX }]);
  return ok(null);
}

const descricoesDasContas = (arvore: readonly NoConta[], m = new Map<string, string>()): Map<string, string> => {
  for (const n of arvore) {
    m.set(n.classificacao, n.descricao);
    descricoesDasContas(n.filhos, m);
  }
  return m;
};

/**
 * UC03.34: os bens da última versão das propostas do usuário (RLS), em blocos por proposta e grupos por conta
 * analítica, com o subtotal e o total geral. Filtros (RF_PAT_REQ_002): Tipo, Proposta, Meta, Descrição, Conta,
 * Período (vazio é a vigência, RN0294), Exibir valores zerados (RN0383) e Exibir inativos.
 */
export async function listarBens(ctx: ContextoRequisicao, filtros: FiltrosBens = {}, depsParciais: Partial<DepsOrc> = {}): Promise<readonly BlocoBens[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const tipo = tipoDoFiltro(filtros.tipo);
  const descricoes = descricoesDasContas(await deps.estruturaCompleta.listarArvoreContas(deps.cliente));
  const inicio = filtros.inicio ? lerDataCivil(filtros.inicio) : null;
  const fim = filtros.fim ? lerDataCivil(filtros.fim) : null;
  const exibirZerados = filtros.exibirZerados !== false;
  const filtrando = Boolean(filtros.meta?.trim() || filtros.descricao?.trim() || filtros.conta?.trim() || inicio || fim);
  return emUnidade(
    ctx,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, ...(tipo ? { tipo } : {}) },
        include: { unidade: { select: { codigo: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } },
      });
      const blocos: BlocoBens[] = [];
      for (const p of propostas) {
        const v = p.versoes[0];
        if (!v || !contem(`${p.unidade.codigo} ${p.objeto}`, filtros.proposta)) continue;
        const metas = await metasDaVersao(tx, v.id);
        const nomeMeta = new Map(metas.todas.map((m) => [m.id, `${m.numero} – ${m.nome}`]));
        const gravados = await tx.bemProposta.findMany({ where: { versaoPropostaId: v.id }, orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }] });
        const tela = gravados
          .map((g): BemTela => {
            const b = paraValidado(g);
            return {
              id: g.id,
              metaId: g.metaId,
              meta: g.metaId ? (nomeMeta.get(g.metaId) ?? null) : null,
              conta: g.conta,
              descricao: g.descricao,
              data: dataParaTexto(g.data),
              quantidade: g.quantidade,
              valorUnitario: b.valorUnitario,
              valorTotal: totalDoBem(b),
              ativo: g.ativo,
              copiado: g.origemId !== null,
              versao: g.versao,
            };
          })
          .filter(
            (b) =>
              (!filtros.meta?.trim() || (b.meta !== null && contem(b.meta, filtros.meta))) &&
              contem(b.descricao, filtros.descricao) &&
              contem(`${b.conta} ${descricoes.get(b.conta) ?? ''}`, filtros.conta) &&
              (!inicio || b.data >= dataParaTexto(inicio)) &&
              (!fim || b.data <= dataParaTexto(fim)),
          );
        const ativos = tela.filter((b) => b.ativo);
        const inativos = tela.filter((b) => !b.ativo);
        if (filtrando && ativos.length === 0 && (!filtros.exibirInativos || inativos.length === 0)) continue;
        const { grupos, total } = agruparPorConta(ativos, exibirZerados);
        blocos.push({
          ...cabecalho(p, v, metas.ativas),
          grupos: grupos.map((g) => ({ ...g, descricaoConta: descricoes.get(g.conta) ?? M.VIAGEM_CONTA_FORA_DO_PLANO })),
          total,
          inativos: inativos.length,
          listaInativos: filtros.exibirInativos ? inativos : [],
        });
      }
      return blocos.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    },
    { cliente: deps.cliente },
  );
}

async function lerBem(tx: TxCliente, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return tx.bemProposta.findFirst({ where: { id }, include: { versaoProposta: { select: { propostaId: true } }, meta: { select: { numero: true } } } });
}

const indiceDe = (deps: DepsOrc) => deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente);
const validarNaVersao = (lida: VersaoLida, campos: Readonly<Record<string, unknown>>) => validarBem(campos, lida.vigencia);

/** UC03.35: inclui o bem na última versão da proposta. */
export async function incluirBem(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ descricao: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.bem, deps);
  const parse = entradaIncluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { propostaId, versaoCapa, metaId, ...campos } = parse.data;
  const indice = await indiceDe(deps);
  return executarPessoal(ctx, deps, async (tx) => {
    const lida = await lerVersaoEditavel(tx, propostaId, versaoCapa, M.BEM_VERSAO_IMUTAVEL);
    if (!lida.ok) return lida;
    const v = validarNaVersao(lida.valor, campos);
    if (!v.ok) return v;
    const meta = await resolverMeta(tx, lida.valor, metaId);
    if (!meta.ok) return meta;
    const conta = conferirConta(indice, deps, v.valor.conta);
    if (!conta.ok) return conta;
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoId, versaoNumero } = lida.valor;
    const criado = await tx.bemProposta.create({
      data: { unidadeId, versaoPropostaId: versaoId, ...dadosGravados(v.valor, meta.valor?.id ?? null), criadoPor: ctx.usuarioId },
      select: { id: true },
    });
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criado.id,
      descricao: `Item "${v.valor.descricao}" incluído na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      depois: retrato(v.valor, numeroTp, versaoNumero, meta.valor?.numero ?? null),
    });
    return ok({ descricao: v.valor.descricao });
  });
}

/** UC03.36: altera todos os campos, inclusive a meta e a conta (D-P22-4). O inativo não se altera. */
export async function alterarBem(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ descricao: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.bem, deps);
  const parse = entradaAlterar.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoBem, versaoCapa, metaId, ...campos } = parse.data;
  const indice = await indiceDe(deps);
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerBem(tx, id);
    if (!e) return inexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.BEM_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    if (!e.ativo) return falha([{ campo: '_', mensagem: M.BEM_INATIVO }]);
    const v = validarNaVersao(lida.valor, campos);
    if (!v.ok) return v;
    const meta = await resolverMeta(tx, lida.valor, metaId);
    if (!meta.ok) return meta;
    const conta = conferirConta(indice, deps, v.valor.conta);
    if (!conta.ok) return conta;
    if (e.versao !== versaoBem) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.bemProposta.updateMany({ where: { id, versao: versaoBem, ativo: true }, data: { ...dadosGravados(v.valor, meta.valor?.id ?? null), versao: { increment: 1 } } }),
    );
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Item "${v.valor.descricao}" alterado na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato(paraValidado(e), numeroTp, versaoNumero, e.meta?.numero ?? null),
      depois: retrato(v.valor, numeroTp, versaoNumero, meta.valor?.numero ?? null),
    });
    return ok({ descricao: v.valor.descricao });
  });
}

/**
 * UC03.37 e RN_PLA_11 (D-P22-6): o bem que veio de versão anterior é inativado (A1); o nascido na versão é
 * apagado. O já inativo não muda.
 */
export async function excluirBem(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ descricao: string; inativado: boolean }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoBem, versaoCapa } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerBem(tx, id);
    if (!e) return inexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.BEM_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    if (!e.ativo) return falha([{ campo: '_', mensagem: M.BEM_INATIVO }]);
    if (e.versao !== versaoBem) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    const inativar = e.origemId !== null;
    if (inativar) {
      exigirUmaLinha(
        await tx.bemProposta.updateMany({ where: { id, versao: versaoBem, ativo: true }, data: { ativo: false, inativadoEm: deps.agora(), versao: { increment: 1 } } }),
      );
    } else {
      exigirUmaLinha(await tx.bemProposta.deleteMany({ where: { id, versao: versaoBem } }));
    }
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: inativar ? 'ALTERACAO' : 'EXCLUSAO',
      registroId: id,
      descricao: `Item "${e.descricao}" ${inativar ? 'inativado' : 'excluído'} na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato(paraValidado(e), numeroTp, versaoNumero, e.meta?.numero ?? null),
      ...(inativar ? { depois: { ...retrato(paraValidado(e), numeroTp, versaoNumero, e.meta?.numero ?? null), ativo: false } } : {}),
    });
    return ok({ descricao: e.descricao, inativado: inativar });
  });
}

/**
 * RN_DUP_003 (D-P22-9): copia os bens ativos de uma versão para outra, com ids novos e a meta de destino de
 * mesmo número. Na nova versão (mesma proposta), guarda a origem: a exclusão ali vira inativação. Na
 * duplicação (outra proposta), sem origem, só com a mesma categoria e só o que cabe na vigência nova.
 */
export async function copiarBensDaVersao(tx: TxCliente, origemVersaoId: string, destinoVersaoId: string, criadoPor: string): Promise<void> {
  const bens = await tx.bemProposta.findMany({ where: { versaoPropostaId: origemVersaoId, ativo: true }, include: { meta: { select: { numero: true } } } });
  if (bens.length === 0) return;
  const capa = { select: { id: true, categoria: true, inicio: true, fim: true } } as const;
  const origem = await tx.versaoProposta.findUniqueOrThrow({ where: { id: origemVersaoId }, select: { proposta: capa } });
  const destino = await tx.versaoProposta.findUniqueOrThrow({
    where: { id: destinoVersaoId },
    select: { unidadeId: true, proposta: capa, metas: { select: { id: true, numero: true } } },
  });
  const novaVersao = origem.proposta.id === destino.proposta.id;
  if (!novaVersao && origem.proposta.categoria !== destino.proposta.categoria) return;
  const cabe = (d: Date) => d >= destino.proposta.inicio && d <= destino.proposta.fim;
  const metaDe = new Map(destino.metas.map((m) => [m.numero, m.id]));
  const copiar = bens.filter((b) => novaVersao || cabe(b.data));
  if (copiar.length === 0) return;
  await tx.bemProposta.createMany({
    data: copiar.map((b) => ({
      unidadeId: destino.unidadeId,
      versaoPropostaId: destinoVersaoId,
      criadoPor,
      metaId: b.meta ? (metaDe.get(b.meta.numero) ?? null) : null,
      conta: b.conta,
      descricao: b.descricao,
      data: b.data,
      quantidade: b.quantidade,
      valorUnitario: b.valorUnitario,
      origemId: novaVersao ? b.id : null,
    })),
  });
}
