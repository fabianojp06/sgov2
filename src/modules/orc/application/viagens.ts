import { z } from 'zod';
import type { IndiceEstruturaFinanceira, NoConta } from '@/modules/cad/servidor';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import {
  contaSob,
  custoDaViagem,
  indicadores,
  sinteticasAninhadas,
  validarTeto,
  validarViagem,
  type CustoViagem,
  type IndicadoresViagens,
  type ViagemValidada,
} from '../domain/viagem';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';
import { situacaoDaViagem, type SituacaoViagem } from './lote-viagem';
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

// Viagens da proposta de TP (US-071; Viagens V3, que substitui os UC03.29 a UC03.33 pela C15; plano do P21,
// Task 1). Na versão da proposta: os tetos por conta sintética (Camada 1, C6, informados por decisão do PO
// de 13/11, D-P21-5) e as viagens (Camada 2), com o custo da RN_VIA_03 calculado na leitura (D-P21-3). As
// peças de concorrência são as do pessoal (P20): toda operação sobe a versão da capa, e toda recusa vem antes.

const FUNCIONALIDADE = 'orc.viagens';

export type FiltrosViagens = FiltrosPessoal & {
  localidade?: string | undefined;
};

export type ViagemTela = {
  id: string;
  metaId: string | null;
  localidade: string;
  pessoas: number;
  dias: number;
  valorPassagem: Dinheiro;
  valorDiaria: Dinheiro;
  valorTransporte: Dinheiro;
  contaPassagem: string;
  contaDiaria: string;
  contaTransporte: string | null;
  custo: CustoViagem;
  versao: number;
  /** US-081 (D-P28-8): a situação da linha no WA02. */
  validacao?: SituacaoViagem;
};

export type TetoTela = {
  id: string;
  contaSintetica: string;
  descricao: string;
  valor: Dinheiro;
  consumido: Dinheiro;
  saldo: Dinheiro;
  versao: number;
};

export type GrupoViagens = {
  metaId: string | null;
  metaNumero: string | null;
  metaNome: string | null;
  viagens: readonly ViagemTela[];
};

export type BlocoViagens = CabecalhoBloco & {
  /** Camada 1, com o consumido de todas as viagens da versão (os filtros não mudam o teto). */
  tetos: readonly TetoTela[];
  /** Por meta na categoria Meta (REQ_VIA_002 do UC03.29); um grupo só, sem meta, na Consolidada. */
  grupos: readonly GrupoViagens[];
  /** O painel das viagens mostradas (REQ_VIA_004 a 006). */
  indicadores: IndicadoresViagens;
  /** US-081 (D-P28-5): o [Solicitar Validação] cabe (versão Oficializada, nada em validação, alguma a enviar). */
  validavel?: boolean;
};

export type OpcoesViagem = {
  analiticas: readonly OpcaoEstrutura[];
  sinteticas: readonly OpcaoEstrutura[];
  descricoes: ReadonlyMap<string, string>;
};

const versao = z.coerce.number().int().min(0);
const texto = z.string().optional();
const camposViagem = {
  localidade: texto,
  pessoas: texto,
  dias: texto,
  valorPassagem: texto,
  valorDiaria: texto,
  valorTransporte: texto,
};
const entradaIncluir = z
  .object({
    propostaId: z.string(),
    versaoCapa: versao,
    metaId: texto,
    ...camposViagem,
    contaPassagem: texto,
    contaDiaria: texto,
    contaTransporte: texto,
  })
  .strict();
const entradaAlterar = z
  .object({
    id: z.string(),
    versao,
    versaoCapa: versao,
    ...camposViagem,
    contaTransporte: texto,
  })
  .strict();
const entradaExcluir = z.object({ id: z.string(), versao, versaoCapa: versao }).strict();
const entradaIncluirTeto = z
  .object({
    propostaId: z.string(),
    versaoCapa: versao,
    contaSintetica: texto,
    valor: texto,
  })
  .strict();
const entradaAlterarTeto = z.object({ id: z.string(), versao, versaoCapa: versao, valor: texto }).strict();

const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.VIAGEM_DADOS_INVALIDOS }]);
const inexistente = () => falha([{ campo: '_', mensagem: M.VIAGEM_INEXISTENTE }]);
const tetoInvalido = () => falha([{ campo: '_', mensagem: M.TETO_DADOS_INVALIDOS }]);
const tetoInexistente = () => falha([{ campo: '_', mensagem: M.TETO_INEXISTENTE }]);

type ViagemGravada = {
  localidade: string;
  pessoas: number;
  dias: number;
  valorPassagem: { toString(): string };
  valorDiaria: { toString(): string };
  valorTransporte: { toString(): string };
  contaPassagem: string;
  contaDiaria: string;
  contaTransporte: string | null;
};

const paraDados = (v: ViagemGravada) => ({
  localidade: v.localidade,
  pessoas: v.pessoas,
  dias: v.dias,
  valorPassagem: Dinheiro.de(v.valorPassagem.toString()),
  valorDiaria: Dinheiro.de(v.valorDiaria.toString()),
  valorTransporte: Dinheiro.de(v.valorTransporte.toString()),
  contaPassagem: v.contaPassagem,
  contaDiaria: v.contaDiaria,
  contaTransporte: v.contaTransporte,
});

// O que vai ao Histórico (RN0232): a viagem como o usuário a vê, com o custo calculado.
const retrato = (v: ViagemValidada, tp: string, versaoProposta: number, meta: string | null) => ({
  numeroTp: tp,
  versaoProposta,
  meta,
  localidade: v.localidade,
  pessoas: v.pessoas,
  dias: v.dias,
  valorPassagem: v.valorPassagem.paraString(),
  valorDiaria: v.valorDiaria.paraString(),
  valorTransporte: v.valorTransporte.paraString(),
  contaPassagem: v.contaPassagem,
  contaDiaria: v.contaDiaria,
  contaTransporte: v.contaTransporte,
  custoEstimado: custoDaViagem(v).estimado.paraString(),
});

const retratoTeto = (t: { contaSintetica: string; valor: Dinheiro }, tp: string, versaoProposta: number) => ({
  numeroTp: tp,
  versaoProposta,
  contaSintetica: t.contaSintetica,
  valor: t.valor.paraString(),
});

const dadosGravados = (v: ViagemValidada) => ({
  localidade: v.localidade,
  pessoas: v.pessoas,
  dias: v.dias,
  valorPassagem: v.valorPassagem.paraString(),
  valorDiaria: v.valorDiaria.paraString(),
  valorTransporte: v.valorTransporte.paraString(),
  contaTransporte: v.contaTransporte,
});

type TetoLido = {
  id: string;
  contaSintetica: string;
  valor: Dinheiro;
  versao: number;
};
type ViagemDaVersao = { id: string } & ReturnType<typeof paraDados>;

/**
 * D-P21-5: o consumido de cada teto é a soma dos componentes passagem e diária cujas contas estão sob a
 * sintética dele. O transporte não conta (C19, Review Focus 1).
 */
function consumidos(tetos: readonly TetoLido[], viagens: readonly ViagemDaVersao[]): Map<string, Dinheiro> {
  const r = new Map(tetos.map((t) => [t.id, Dinheiro.zero()]));
  for (const v of viagens) {
    const c = custoDaViagem(v);
    for (const [conta, valor] of [
      [v.contaPassagem, c.passagem],
      [v.contaDiaria, c.diaria],
    ] as const) {
      const t = tetos.find((x) => contaSob(x.contaSintetica, conta));
      if (t) r.set(t.id, r.get(t.id)!.somar(valor));
    }
  }
  return r;
}

async function tetosEViagens(tx: TxCliente, versaoId: string): Promise<{ tetos: TetoLido[]; viagens: ViagemDaVersao[] }> {
  const [tetos, viagens] = await Promise.all([
    tx.tetoViagemProposta.findMany({
      where: { versaoPropostaId: versaoId },
      select: { id: true, contaSintetica: true, valor: true, versao: true },
    }),
    tx.viagemProposta.findMany({ where: { versaoPropostaId: versaoId } }),
  ]);
  return {
    tetos: tetos.map((t) => ({
      id: t.id,
      contaSintetica: t.contaSintetica,
      valor: Dinheiro.de(t.valor.toString()),
      versao: t.versao,
    })),
    viagens: viagens.map((v) => ({ id: v.id, ...paraDados(v) })),
  };
}

/** RN_VIA_02 e E1 (D-P21-4): as contas informadas precisam ser analíticas ativas do plano. */
function conferirContas(indice: IndiceEstruturaFinanceira, v: ViagemValidada): Resultado<null> {
  const erros: ErroCampo[] = [];
  for (const campo of ['contaPassagem', 'contaDiaria', 'contaTransporte'] as const) {
    const conta = v[campo];
    if (conta !== null && !indice.contaAnaliticaAtiva(conta)) erros.push({ campo, mensagem: M.VIAGEM_CONTA_ANALITICA });
  }
  return erros.length > 0 ? falha(erros) : ok(null);
}

/**
 * C6, E3 e D-P21-5: as contas de passagem e de diária estão sob um teto da versão, e nenhum teto que a viagem
 * toca passa do valor com ela (no alterar, a própria viagem gravada sai da soma: Review Focus 2).
 */
async function conferirTeto(tx: TxCliente, versaoId: string, v: ViagemValidada, semAViagem?: string): Promise<Resultado<null>> {
  const { tetos, viagens } = await tetosEViagens(tx, versaoId);
  const erros: ErroCampo[] = [];
  const tocados = new Set<string>();
  for (const campo of ['contaPassagem', 'contaDiaria'] as const) {
    const t = tetos.find((x) => contaSob(x.contaSintetica, v[campo]));
    if (t) tocados.add(t.id);
    else erros.push({ campo, mensagem: M.VIAGEM_SEM_TETO(v[campo]) });
  }
  if (erros.length > 0) return falha(erros);
  const soma = consumidos(tetos, [...viagens.filter((x) => x.id !== semAViagem), { id: '', ...v }]);
  const estouro = tetos.find((t) => tocados.has(t.id) && soma.get(t.id)!.comparar(t.valor) > 0);
  return estouro ? falha([{ campo: '_', mensagem: M.VIAGEM_ESTOURO_TETO(estouro.contaSintetica) }]) : ok(null);
}

// As descrições das contas (para a Camada 1 e as listas) e as listas do formulário, da estrutura completa (R4).
function opcoesDaArvore(arvore: readonly NoConta[], indice: IndiceEstruturaFinanceira): OpcoesViagem {
  const analiticas: OpcaoEstrutura[] = [];
  const sinteticas: OpcaoEstrutura[] = [];
  const descricoes = new Map<string, string>();
  const percorrer = (nos: readonly NoConta[]) => {
    for (const n of nos) {
      descricoes.set(n.classificacao, n.descricao);
      if (n.tipo === 'ANALITICA' && indice.contaAnaliticaAtiva(n.classificacao))
        analiticas.push({
          classificacao: n.classificacao,
          descricao: n.descricao,
        });
      if (n.tipo === 'SINTETICA' && n.ativa)
        sinteticas.push({
          classificacao: n.classificacao,
          descricao: n.descricao,
        });
      percorrer(n.filhos);
    }
  };
  percorrer(arvore);
  return { analiticas, sinteticas, descricoes };
}

async function carregarOpcoes(deps: DepsOrc): Promise<OpcoesViagem> {
  const [arvore, indice] = await Promise.all([deps.estruturaCompleta.listarArvoreContas(deps.cliente), deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente)]);
  return opcoesDaArvore(arvore, indice);
}

/** As contas do formulário: analíticas ativas (viagem) e sintéticas ativas (teto). */
export async function opcoesViagem(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<OpcoesViagem> {
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  return carregarOpcoes(resolverDeps(depsParciais));
}

/**
 * UC03.29 e Viagens V3: as viagens da última versão das propostas do usuário (RLS), em blocos por proposta,
 * com a Camada 1, o painel e os grupos por meta. Filtros (REQ_VIA_001): Tipo, Proposta, Meta e Localidade.
 */
export async function listarViagens(ctx: ContextoRequisicao, filtros: FiltrosViagens = {}, depsParciais: Partial<DepsOrc> = {}): Promise<readonly BlocoViagens[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const tipo = tipoDoFiltro(filtros.tipo);
  const { descricoes } = await carregarOpcoes(deps);
  return emUnidade(
    ctx,
    async (tx) => {
      const propostas = await tx.propostaTp.findMany({
        where: { excluidaEm: null, ...(tipo ? { tipo } : {}) },
        include: {
          unidade: { select: { codigo: true } },
          versoes: {
            orderBy: { numero: 'desc' },
            take: 1,
            select: { id: true, numero: true, situacao: true },
          },
        },
      });
      const blocos: BlocoViagens[] = [];
      for (const p of propostas) {
        const v = p.versoes[0];
        if (!v || !contem(`${p.unidade.codigo} ${p.objeto}`, filtros.proposta)) continue;
        const metas = await metasDaVersao(tx, v.id);
        const gravadas = await tx.viagemProposta.findMany({
          where: { versaoPropostaId: v.id },
          orderBy: [{ localidade: 'asc' }, { criadoEm: 'asc' }],
          include: { loteViagem: { select: { situacao: true } } },
        });
        const situacoes = gravadas.map((g) => situacaoDaViagem(g.loteViagem));
        const { tetos, viagens: todas } = await tetosEViagens(tx, v.id);
        const soma = consumidos(tetos, todas);
        const tetosTela: TetoTela[] = tetos
          .map((t) => ({
            id: t.id,
            contaSintetica: t.contaSintetica,
            descricao: descricoes.get(t.contaSintetica) ?? M.VIAGEM_CONTA_FORA_DO_PLANO,
            valor: t.valor,
            consumido: soma.get(t.id)!,
            saldo: t.valor.subtrair(soma.get(t.id)!),
            versao: t.versao,
          }))
          .sort((a, b) =>
            a.contaSintetica.localeCompare(b.contaSintetica, 'pt-BR', {
              numeric: true,
            }),
          );

        const chaves = [
          ...metas.todas.map((m) => ({
            metaId: m.id as string | null,
            metaNumero: m.numero as string | null,
            metaNome: m.nome as string | null,
          })),
          { metaId: null, metaNumero: null, metaNome: null },
        ];
        const grupos: GrupoViagens[] = [];
        for (const chave of chaves) {
          if (filtros.meta?.trim() && (chave.metaId === null || !contem(`${chave.metaNumero} ${chave.metaNome}`, filtros.meta))) continue;
          const viagens = gravadas
            .filter((g) => g.metaId === chave.metaId && contem(g.localidade, filtros.localidade))
            .map((g): ViagemTela => {
              const dados = paraDados(g);
              return {
                id: g.id,
                metaId: g.metaId,
                ...dados,
                custo: custoDaViagem(dados),
                versao: g.versao,
                validacao: situacaoDaViagem(g.loteViagem),
              };
            });
          if (viagens.length > 0) grupos.push({ ...chave, viagens });
        }
        if ((filtros.meta?.trim() || filtros.localidade?.trim()) && grupos.length === 0) continue;
        blocos.push({
          ...cabecalho(p, v, metas.ativas),
          tetos: tetosTela,
          grupos,
          indicadores: indicadores(grupos.flatMap((g) => g.viagens)),
          validavel: v.situacao === 'OFICIALIZADO' && !situacoes.includes('EM_VALIDACAO') && situacoes.some((s) => s === 'PENDENTE' || s === 'REJEITADO'),
        });
      }
      return blocos.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    },
    { cliente: deps.cliente },
  );
}

/** A viagem e a proposta dela; nula se o usuário não a vê (RLS) ou o id não é válido. */
async function lerViagem(tx: TxCliente, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return tx.viagemProposta.findFirst({
    where: { id },
    include: {
      versaoProposta: { select: { propostaId: true } },
      meta: { select: { numero: true } },
    },
  });
}

async function lerTeto(tx: TxCliente, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return tx.tetoViagemProposta.findFirst({
    where: { id },
    include: { versaoProposta: { select: { propostaId: true } } },
  });
}

const indiceDe = (deps: DepsOrc) => deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente);

/** UC03.31 e Viagens V3 (fluxo principal e fluxo B, copiar): inclui a viagem na última versão da proposta. */
export async function incluirViagem(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ localidade: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.viagem, deps);
  const parse = entradaIncluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { propostaId, versaoCapa, metaId, ...campos } = parse.data;
  const indice = await indiceDe(deps);
  return executarPessoal(ctx, deps, async (tx) => {
    const lida = await lerVersaoEditavel(tx, propostaId, versaoCapa, M.VIAGEM_VERSAO_IMUTAVEL);
    if (!lida.ok) return lida;
    const v = validarViagem(campos);
    if (!v.ok) return v;
    const meta = await resolverMeta(tx, lida.valor, metaId);
    if (!meta.ok) return meta;
    const contas = conferirContas(indice, v.valor);
    if (!contas.ok) return contas;
    const teto = await conferirTeto(tx, lida.valor.versaoId, v.valor);
    if (!teto.ok) return teto;
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoId, versaoNumero } = lida.valor;
    const criada = await tx.viagemProposta.create({
      data: {
        unidadeId,
        versaoPropostaId: versaoId,
        metaId: meta.valor?.id ?? null,
        ...dadosGravados(v.valor),
        contaPassagem: v.valor.contaPassagem,
        contaDiaria: v.valor.contaDiaria,
        criadoPor: ctx.usuarioId,
      },
      select: { id: true },
    });
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criada.id,
      descricao: `Viagem para ${v.valor.localidade} incluída na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      depois: retrato(v.valor, numeroTp, versaoNumero, meta.valor?.numero ?? null),
    });
    return ok({ localidade: v.valor.localidade });
  });
}

/**
 * UC03.32 e Viagens V3 (fluxo A): altera localidade, pessoas, dias e valores. A meta e as contas de passagem
 * e de diária são só leitura (RN_VIA_07); a de transporte, só enquanto não houver uma (D-P21-6). As contas
 * gravadas são conferidas de novo: a que deixou de ser analítica ativa recusa (Review Focus 3).
 */
export async function alterarViagem(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ localidade: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, [...CAMPOS_ORIGEM_BLINDADA.viagem, 'metaId', 'contaPassagem', 'contaDiaria'], deps);
  const parse = entradaAlterar.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoViagem, versaoCapa, ...campos } = parse.data;
  const indice = await indiceDe(deps);
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerViagem(tx, id);
    if (!e) return inexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.VIAGEM_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    const v = validarViagem({
      ...campos,
      contaPassagem: e.contaPassagem,
      contaDiaria: e.contaDiaria,
      contaTransporte: e.contaTransporte ?? campos.contaTransporte,
    });
    if (!v.ok) return v;
    const contas = conferirContas(indice, v.valor);
    if (!contas.ok) return contas;
    const teto = await conferirTeto(tx, lida.valor.versaoId, v.valor, id);
    if (!teto.ok) return teto;
    if (e.versao !== versaoViagem) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.viagemProposta.updateMany({
        where: { id, versao: versaoViagem },
        data: { ...dadosGravados(v.valor), versao: { increment: 1 } },
      }),
    );
    const meta = e.meta?.numero ?? null;
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Viagem para ${v.valor.localidade} alterada na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato({ ...paraDados(e) }, numeroTp, versaoNumero, meta),
      depois: retrato(v.valor, numeroTp, versaoNumero, meta),
    });
    return ok({ localidade: v.valor.localidade });
  });
}

/** UC03.33: exclusão física (D-P21-9), só na última versão editável (E2). */
export async function excluirViagem(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ localidade: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoViagem, versaoCapa } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerViagem(tx, id);
    if (!e) return inexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.VIAGEM_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    if (e.versao !== versaoViagem) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.viagemProposta.deleteMany({
        where: { id, versao: versaoViagem },
      }),
    );
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: id,
      descricao: `Viagem para ${e.localidade} excluída da versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato(paraDados(e), numeroTp, versaoNumero, e.meta?.numero ?? null),
    });
    return ok({ localidade: e.localidade });
  });
}

/** C6 e D-P21-5: a conta é sintética ativa, sem outra da mesma ramificação com teto na versão. */
async function conferirSintetica(tx: TxCliente, indice: IndiceEstruturaFinanceira, lida: VersaoLida, conta: string): Promise<Resultado<null>> {
  if (!indice.nosContas.some((n) => n.id === conta && n.tipo === 'SINTETICA')) return falha([{ campo: 'contaSintetica', mensagem: M.TETO_CONTA_SINTETICA }]);
  const outras = await tx.tetoViagemProposta.findMany({
    where: { versaoPropostaId: lida.versaoId },
    select: { contaSintetica: true },
  });
  const repetida = outras.find((o) => o.contaSintetica === conta);
  if (repetida) return falha([{ campo: 'contaSintetica', mensagem: M.TETO_REPETIDO(conta) }]);
  const aninhada = outras.find((o) => sinteticasAninhadas(o.contaSintetica, conta));
  return aninhada
    ? falha([
        {
          campo: 'contaSintetica',
          mensagem: M.TETO_ANINHADO(aninhada.contaSintetica),
        },
      ])
    : ok(null);
}

/** Camada 1 (UC03.30, REQ_VIA_001 e 002; D-P21-5): inclui o teto de uma conta sintética na versão. */
export async function incluirTeto(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ conta: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.tetoViagem, deps);
  const parse = entradaIncluirTeto.safeParse(bruto);
  if (!parse.success) return tetoInvalido();
  const { propostaId, versaoCapa, ...campos } = parse.data;
  const indice = await indiceDe(deps);
  return executarPessoal(ctx, deps, async (tx) => {
    const lida = await lerVersaoEditavel(tx, propostaId, versaoCapa, M.VIAGEM_VERSAO_IMUTAVEL);
    if (!lida.ok) return lida;
    const t = validarTeto(campos, true);
    if (!t.ok) return t;
    const conta = await conferirSintetica(tx, indice, lida.valor, t.valor.contaSintetica);
    if (!conta.ok) return conta;
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoId, versaoNumero } = lida.valor;
    const criado = await tx.tetoViagemProposta.create({
      data: {
        unidadeId,
        versaoPropostaId: versaoId,
        contaSintetica: t.valor.contaSintetica,
        valor: t.valor.valor.paraString(),
        criadoPor: ctx.usuarioId,
      },
      select: { id: true },
    });
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'INSERCAO',
      registroId: criado.id,
      descricao: `Teto de viagens da conta ${t.valor.contaSintetica} incluído na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      depois: retratoTeto(t.valor, numeroTp, versaoNumero),
    });
    return ok({ conta: t.valor.contaSintetica });
  });
}

/** Altera só o valor do teto (a conta é só leitura), que não pode ficar abaixo do consumido (D-P21-5). */
export async function alterarTeto(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ conta: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, [...CAMPOS_ORIGEM_BLINDADA.tetoViagem, 'contaSintetica'], deps);
  const parse = entradaAlterarTeto.safeParse(bruto);
  if (!parse.success) return tetoInvalido();
  const { id, versao: versaoTeto, versaoCapa, ...campos } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerTeto(tx, id);
    if (!e) return tetoInexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.VIAGEM_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    const t = validarTeto(campos, false);
    if (!t.ok) return t;
    const { tetos, viagens } = await tetosEViagens(tx, e.versaoPropostaId);
    const consumido = consumidos(tetos, viagens).get(id) ?? Dinheiro.zero();
    if (t.valor.valor.comparar(consumido) < 0)
      return falha([
        {
          campo: 'valor',
          mensagem: M.TETO_ABAIXO_CONSUMIDO(consumido.formatar()),
        },
      ]);
    if (e.versao !== versaoTeto) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.tetoViagemProposta.updateMany({
        where: { id, versao: versaoTeto },
        data: { valor: t.valor.valor.paraString(), versao: { increment: 1 } },
      }),
    );
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Teto de viagens da conta ${e.contaSintetica} alterado na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retratoTeto(
        {
          contaSintetica: e.contaSintetica,
          valor: Dinheiro.de(e.valor.toString()),
        },
        numeroTp,
        versaoNumero,
      ),
      depois: retratoTeto({ contaSintetica: e.contaSintetica, valor: t.valor.valor }, numeroTp, versaoNumero),
    });
    return ok({ conta: e.contaSintetica });
  });
}

/** Exclui o teto (físico), recusado enquanto houver viagem com passagem ou diária sob ele (D-P21-5). */
export async function excluirTeto(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ conta: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return tetoInvalido();
  const { id, versao: versaoTeto, versaoCapa } = parse.data;
  return executarPessoal(ctx, deps, async (tx) => {
    const e = await lerTeto(tx, id);
    if (!e) return tetoInexistente();
    const lida = await lerVersaoEditavel(tx, e.versaoProposta.propostaId, versaoCapa, M.VIAGEM_VERSAO_IMUTAVEL, e.versaoPropostaId);
    if (!lida.ok) return lida;
    const { viagens } = await tetosEViagens(tx, e.versaoPropostaId);
    if (viagens.some((v) => contaSob(e.contaSintetica, v.contaPassagem) || contaSob(e.contaSintetica, v.contaDiaria))) return falha([{ campo: '_', mensagem: M.TETO_COM_VIAGENS }]);
    if (e.versao !== versaoTeto) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    await travarVersao(tx, lida.valor);

    const { unidadeId, numeroTp, versaoNumero } = lida.valor;
    exigirUmaLinha(
      await tx.tetoViagemProposta.deleteMany({
        where: { id, versao: versaoTeto },
      }),
    );
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'EXCLUSAO',
      registroId: id,
      descricao: `Teto de viagens da conta ${e.contaSintetica} excluído da versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retratoTeto(
        {
          contaSintetica: e.contaSintetica,
          valor: Dinheiro.de(e.valor.toString()),
        },
        numeroTp,
        versaoNumero,
      ),
    });
    return ok({ conta: e.contaSintetica });
  });
}

/**
 * RN_DUP_003 (D-P21-8): copia tetos e viagens de uma versão para outra, com ids novos e a meta de destino de
 * mesmo número. Chamada pelo copiarLinhasDaVersao depois das metas. Os tetos vêm sempre; as viagens, só com
 * a mesma categoria (a meta seria incoerente, como no pessoal da D-P20-8). Sem período, a vigência não filtra.
 */
export async function copiarViagensDaVersao(tx: TxCliente, origemVersaoId: string, destinoVersaoId: string, criadoPor: string): Promise<void> {
  const [tetos, viagens] = await Promise.all([
    tx.tetoViagemProposta.findMany({
      where: { versaoPropostaId: origemVersaoId },
    }),
    tx.viagemProposta.findMany({
      where: { versaoPropostaId: origemVersaoId },
      include: { meta: { select: { numero: true } } },
    }),
  ]);
  if (tetos.length === 0 && viagens.length === 0) return;
  const origem = await tx.versaoProposta.findUniqueOrThrow({
    where: { id: origemVersaoId },
    select: { proposta: { select: { categoria: true } } },
  });
  const destino = await tx.versaoProposta.findUniqueOrThrow({
    where: { id: destinoVersaoId },
    select: {
      unidadeId: true,
      proposta: { select: { categoria: true } },
      metas: { select: { id: true, numero: true } },
    },
  });
  const base = {
    unidadeId: destino.unidadeId,
    versaoPropostaId: destinoVersaoId,
    criadoPor,
  };
  if (tetos.length > 0)
    await tx.tetoViagemProposta.createMany({
      data: tetos.map((t) => ({
        ...base,
        contaSintetica: t.contaSintetica,
        valor: t.valor,
      })),
    });
  if (viagens.length === 0 || origem.proposta.categoria !== destino.proposta.categoria) return;
  const metaDe = new Map(destino.metas.map((m) => [m.numero, m.id]));
  await tx.viagemProposta.createMany({
    data: viagens.map((v) => ({
      ...base,
      metaId: v.meta ? (metaDe.get(v.meta.numero) ?? null) : null,
      localidade: v.localidade,
      pessoas: v.pessoas,
      dias: v.dias,
      valorPassagem: v.valorPassagem,
      valorDiaria: v.valorDiaria,
      valorTransporte: v.valorTransporte,
      contaPassagem: v.contaPassagem,
      contaDiaria: v.contaDiaria,
      contaTransporte: v.contaTransporte,
    })),
  });
}
