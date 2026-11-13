import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, Dinheiro, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { validarMeta, type MetaValidada, type StatusMeta } from '../domain/meta';
import { SITUACOES_VERSIONAVEIS, TIPOS_PROPOSTA, type CategoriaProposta, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Metas da proposta de TP (US-067, UC03.14 a UC03.17; plano do P19, Task 1). A meta é da versão (D-P19-1);
// a tela mexe nas da última versão de cada proposta, só na categoria Meta (D-P19-2) e com a versão em
// Rascunho ou Em Elaboração (RN0183, D-P19-5). Como no P18, toda operação começa subindo a versão da capa
// (updateMany condicional e exigirUmaLinha): a capa fica travada até o commit, e a duplicação, a nova versão
// ou outra edição de meta concorrente cai em ALTERADO_POR_OUTRO (regra do copiarLinhasDaVersao).

const FUNCIONALIDADE = 'orc.metas';

/** Onde se mexe nas metas: as mesmas situações de onde se versiona (RN0183, RN_ALT_002). */
const SITUACOES_EDITAVEIS: readonly string[] = SITUACOES_VERSIONAVEIS;

export type MetaTela = {
  id: string;
  numero: string;
  nome: string;
  valor: Dinheiro;
  status: StatusMeta;
  observacao: string | null;
  /** Versão de concorrência da meta. */
  versao: number;
};

/** As metas da última versão de uma proposta, com os totais (RN0137, RN0142, RN0149). */
export type BlocoMetas = {
  propostaId: string;
  numero: string;
  objeto: string;
  tipo: TipoProposta;
  categoria: CategoriaProposta;
  versaoNumero: number;
  situacao: SituacaoProposta;
  /** Categoria Meta e versão em Rascunho ou Em Elaboração. */
  editavel: boolean;
  /** Versão de concorrência da capa: vai em toda operação. */
  versaoCapa: number;
  /** Sempre calculado (§6.2): zero até existirem lançamentos (US-070 a 072). */
  valorGlobal: Dinheiro;
  /** Soma das metas ativas (RN0149). */
  totalMetas: Dinheiro;
  /** Valor Global − total das metas (RN0142, D-P19-4) [PROVISÓRIO]. */
  saldo: Dinheiro;
  metas: readonly MetaTela[];
};

export type FiltrosMetas = { tipo?: string | undefined; proposta?: string | undefined; meta?: string | undefined };

const ultimaVersao = { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } as const;
const uuid = z.uuid();
const versao = z.coerce.number().int().min(0);
const texto = z.string().optional();

// Campos do formulário (D-P19-3). Tipo e proposta vêm da capa (ORIGEM BLINDADA, RN0140), recusados antes.
const entradaIncluir = z.object({ propostaId: z.string(), versaoCapa: versao, numero: texto, nome: texto, valor: texto, status: texto, observacao: texto }).strict();
const entradaAlterar = z.object({ id: z.string(), versao, versaoCapa: versao, nome: texto, valor: texto, status: texto, observacao: texto }).strict();
const entradaExcluir = z.object({ id: z.string(), versao, versaoCapa: versao }).strict();

/** Número já usado na versão: desfaz a transação (a capa subiu) e vira a mensagem do número. */
class NumeroEmUso extends Error {}

const alterado = () => falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.META_DADOS_INVALIDOS }]);
const numeroDuplicado = (numero: string) => falha([{ campo: 'numero', mensagem: M.META_NUMERO_DUPLICADO(numero) }]);

// Unicidade violada na gravação (corrida entre duas inclusões): P2002 pelo Prisma ou 23505 no texto.
const violouUnicidade = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b/.test(e.message));
// Meta com lançamento ligado (RN0136, D-P19-6): a FK das US-070 a 073 recusa o DELETE.
const violouVinculo = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') || (e instanceof Error && /\b23503\b/.test(e.message));

const contem = (alvo: string, termo: string | undefined) => !termo || alvo.toLocaleLowerCase('pt-BR').includes(termo.trim().toLocaleLowerCase('pt-BR'));
const daMeta = (m: { valor: Prisma.Decimal; status: string }) => ({ valor: Dinheiro.de(m.valor), ativa: m.status === 'ATIVO' });

// O que vai ao Histórico: a meta como o usuário a vê, com o TP e a versão.
const retrato = (m: { numero: string; nome: string; valor: Dinheiro; status: string; observacao: string | null }, tp: string, versaoProposta: number) => ({
  numeroTp: tp,
  versaoProposta,
  numero: m.numero,
  nome: m.nome,
  valor: m.valor.paraString(),
  status: m.status,
  observacao: m.observacao,
});

/**
 * UC03.14: as metas da última versão das propostas do usuário (RLS), em blocos por proposta (RN0137), pela
 * ordem do número do TP. Os filtros valem juntos ou sozinhos (REQ0024) e por parte do texto (REQ0030): Tipo
 * (exato), Proposta (número ou objeto) e Meta (número ou nome; o bloco sem meta encontrada sai).
 */
export async function listarMetas(ctx: ContextoRequisicao, filtros: FiltrosMetas = {}, depsParciais: Partial<DepsOrc> = {}): Promise<readonly BlocoMetas[]> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const tipo = (TIPOS_PROPOSTA as readonly string[]).includes(filtros.tipo ?? '') ? filtros.tipo : undefined;
  const linhas = await emUnidade(
    ctx,
    (tx) =>
      tx.propostaTp.findMany({
        where: { excluidaEm: null, ...(tipo ? { tipo } : {}) },
        include: {
          unidade: { select: { codigo: true } },
          versoes: { orderBy: { numero: 'desc' }, take: 1, select: { numero: true, situacao: true, metas: true } },
        },
      }),
    { cliente: deps.cliente },
  );
  const blocos: BlocoMetas[] = [];
  for (const p of linhas) {
    const v = p.versoes[0];
    if (!v || !contem(`${p.unidade.codigo} ${p.objeto}`, filtros.proposta)) continue;
    const todas = v.metas
      .map((m): MetaTela => ({ id: m.id, numero: m.numero, nome: m.nome, valor: Dinheiro.de(m.valor), status: m.status as StatusMeta, observacao: m.observacao, versao: m.versao }))
      .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    const metas = todas.filter((m) => contem(`${m.numero} ${m.nome}`, filtros.meta));
    if (filtros.meta?.trim() && metas.length === 0) continue;
    const totalMetas = Dinheiro.somarTodos(v.metas.map(daMeta).filter((m) => m.ativa).map((m) => m.valor));
    const valorGlobal = Dinheiro.zero();
    blocos.push({
      propostaId: p.id,
      numero: p.unidade.codigo,
      objeto: p.objeto,
      tipo: p.tipo as TipoProposta,
      categoria: p.categoria as CategoriaProposta,
      versaoNumero: v.numero,
      situacao: v.situacao as SituacaoProposta,
      editavel: p.categoria === 'META' && SITUACOES_EDITAVEIS.includes(v.situacao),
      versaoCapa: p.versao,
      valorGlobal,
      totalMetas,
      saldo: valorGlobal.subtrair(totalMetas),
      metas,
    });
  }
  return blocos.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

type VersaoEditavel = { unidadeId: string; numeroTp: string; versaoId: string; versaoNumero: number };

/**
 * Confere a proposta (existe, categoria Meta, versão da capa, última versão editável) e trava a capa,
 * subindo a versão dela. Recusa só antes de travar; depois, a última versão mudada é conflito.
 */
async function travarVersaoEditavel(tx: TxCliente, propostaId: string, versaoCapa: number): Promise<Resultado<VersaoEditavel>> {
  if (!uuid.safeParse(propostaId).success) return falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  const p = await tx.propostaTp.findFirst({ where: { id: propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } }, versoes: ultimaVersao } });
  if (!p) return falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  if (p.categoria !== 'META') return falha([{ campo: '_', mensagem: M.META_SEM_CATEGORIA }]);
  if (p.versao !== versaoCapa) return alterado();
  const v = p.versoes[0];
  if (!v || !SITUACOES_EDITAVEIS.includes(v.situacao)) return falha([{ campo: '_', mensagem: M.META_VERSAO_IMUTAVEL }]);

  exigirUmaLinha(await tx.propostaTp.updateMany({ where: { id: propostaId, versao: versaoCapa, excluidaEm: null }, data: { versao: { increment: 1 } } }));
  const agora = await tx.versaoProposta.findFirst({ where: { propostaId }, ...ultimaVersao });
  if (agora?.id !== v.id || agora.situacao !== v.situacao) throw new ConflitoConcorrencia();
  return ok({ unidadeId: p.unidadeId, numeroTp: p.unidade.codigo, versaoId: v.id, versaoNumero: v.numero });
}

/** A meta e a proposta dela; nulo se o usuário não a vê (RLS) ou o id não é válido. */
async function lerMeta(tx: TxCliente, id: string) {
  if (!uuid.safeParse(id).success) return null;
  return tx.metaProposta.findFirst({ where: { id }, include: { versaoProposta: { select: { propostaId: true } } } });
}

async function executar<T>(ctx: ContextoRequisicao, deps: DepsOrc, corpo: (tx: TxCliente) => Promise<Resultado<T>>, numero?: string): Promise<Resultado<T>> {
  try {
    return await emUnidade(ctx, corpo, { cliente: deps.cliente });
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia) return alterado();
    // Na corrida de duas inclusões com o mesmo número, a trava da capa barra a segunda; o índice é a segunda barreira.
    if (numero !== undefined && violouUnicidade(erro)) return numeroDuplicado(numero);
    throw erro;
  }
}

/** UC03.15: inclui a meta na última versão da proposta (RN0139, RN0183, RN0232). */
export async function incluirMeta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, CAMPOS_ORIGEM_BLINDADA.meta, deps);
  const parse = entradaIncluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { propostaId, versaoCapa, ...campos } = parse.data;
  const v = validarMeta(campos, 'incluir');
  if (!v.ok) return v;
  const meta = v.valor;
  return executar(
    ctx,
    deps,
    async (tx) => {
      const alvo = await travarVersaoEditavel(tx, propostaId, versaoCapa);
      if (!alvo.ok) return alvo;
      const { unidadeId, numeroTp, versaoId, versaoNumero } = alvo.valor;
      // Conferência com a capa travada, para a mensagem certa sem depender do erro do índice.
      if (await tx.metaProposta.findFirst({ where: { versaoPropostaId: versaoId, numero: { equals: meta.numero, mode: 'insensitive' } }, select: { id: true } }))
        throw new NumeroEmUso();
      const criada = await tx.metaProposta.create({
        data: { unidadeId, versaoPropostaId: versaoId, ...dadosGravados(meta), numero: meta.numero, criadoPor: ctx.usuarioId },
        select: { id: true },
      });
      await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId },
        funcionalidade: FUNCIONALIDADE,
        tipo: 'INSERCAO',
        registroId: criada.id,
        descricao: `Meta ${meta.numero} incluída na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
        depois: retrato(meta, numeroTp, versaoNumero),
      });
      return ok({ numero: meta.numero });
    },
    meta.numero,
  ).catch((erro: unknown) => {
    if (erro instanceof NumeroEmUso) return numeroDuplicado(meta.numero);
    throw erro;
  });
}

const dadosGravados = (m: Omit<MetaValidada, 'numero'>) => ({ nome: m.nome, valor: m.valor.paraString(), status: m.status, observacao: m.observacao });

/**
 * UC03.16: altera nome, valor, status e observação (o número, o tipo e a proposta são só leitura, RN0140).
 * Só a meta da última versão, editável; a das versões anteriores fica como estava.
 */
export async function alterarMeta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'alterar');
  await recusarCamposBlindados(ctx, FUNCIONALIDADE, bruto, [...CAMPOS_ORIGEM_BLINDADA.meta, 'numero'], deps);
  const parse = entradaAlterar.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoMeta, versaoCapa, ...campos } = parse.data;
  const v = validarMeta(campos, 'alterar');
  if (!v.ok) return v;
  const novo = v.valor;
  return executar(ctx, deps, async (tx) => {
    const m = await lerMeta(tx, id);
    if (!m) return falha([{ campo: '_', mensagem: M.META_INEXISTENTE }]);
    const alvo = await travarVersaoEditavel(tx, m.versaoProposta.propostaId, versaoCapa);
    if (!alvo.ok) return alvo;
    const { unidadeId, numeroTp, versaoId, versaoNumero } = alvo.valor;
    if (m.versaoPropostaId !== versaoId) return falha([{ campo: '_', mensagem: M.META_VERSAO_IMUTAVEL }]);
    if (m.versao !== versaoMeta) throw new ConflitoConcorrencia();
    exigirUmaLinha(await tx.metaProposta.updateMany({ where: { id, versao: versaoMeta }, data: { ...dadosGravados(novo), versao: { increment: 1 } } }));
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: id,
      descricao: `Meta ${m.numero} alterada na versão ${versaoNumero} da proposta do TP ${numeroTp}`,
      antes: retrato({ ...m, valor: Dinheiro.de(m.valor) }, numeroTp, versaoNumero),
      depois: retrato({ ...novo, numero: m.numero }, numeroTp, versaoNumero),
    });
    return ok({ numero: m.numero });
  });
}

/** UC03.17: exclusão física (D-P19-6). Com lançamento ligado, a FK recusa (RN0136, E1). */
export async function excluirMeta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'excluir');
  const parse = entradaExcluir.safeParse(bruto);
  if (!parse.success) return dadosInvalidos();
  const { id, versao: versaoMeta, versaoCapa } = parse.data;
  try {
    return await executar(ctx, deps, async (tx) => {
      const m = await lerMeta(tx, id);
      if (!m) return falha([{ campo: '_', mensagem: M.META_INEXISTENTE }]);
      const alvo = await travarVersaoEditavel(tx, m.versaoProposta.propostaId, versaoCapa);
      if (!alvo.ok) return alvo;
      const { unidadeId, numeroTp, versaoId, versaoNumero } = alvo.valor;
      if (m.versaoPropostaId !== versaoId) return falha([{ campo: '_', mensagem: M.META_VERSAO_IMUTAVEL }]);
      if (m.versao !== versaoMeta) throw new ConflitoConcorrencia();
      exigirUmaLinha(await tx.metaProposta.deleteMany({ where: { id, versao: versaoMeta } }));
      await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId },
        funcionalidade: FUNCIONALIDADE,
        tipo: 'EXCLUSAO',
        registroId: id,
        descricao: `Meta ${m.numero} excluída da versão ${versaoNumero} da proposta do TP ${numeroTp}`,
        antes: retrato({ ...m, valor: Dinheiro.de(m.valor) }, numeroTp, versaoNumero),
      });
      return ok({ numero: m.numero });
    });
  } catch (erro) {
    if (violouVinculo(erro)) return falha([{ campo: '_', mensagem: M.META_EXCLUSAO_VINCULADA }]);
    throw erro;
  }
}

/**
 * RN_VIA_04 (D-P19-7): as metas que um lançamento pode apontar, na transação de quem lança (US-070 e US-071):
 * só as ativas da versão, pela ordem do número.
 */
export async function metasParaLancamento(tx: TxCliente, versaoId: string): Promise<readonly { id: string; numero: string; nome: string }[]> {
  const metas = await tx.metaProposta.findMany({ where: { versaoPropostaId: versaoId, status: 'ATIVO' }, select: { id: true, numero: true, nome: true } });
  return metas.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/**
 * RN_DUP_003: copia as metas de uma versão para outra (nova versão e duplicação), com ids novos, na
 * transação de quem chama (copiarLinhasDaVersao). A cópia é da unidade da versão de destino.
 */
export async function copiarMetasDaVersao(tx: TxCliente, origemVersaoId: string, destinoVersaoId: string, criadoPor: string): Promise<void> {
  const metas = await tx.metaProposta.findMany({ where: { versaoPropostaId: origemVersaoId } });
  if (metas.length === 0) return;
  const destino = await tx.versaoProposta.findUniqueOrThrow({ where: { id: destinoVersaoId }, select: { unidadeId: true } });
  await tx.metaProposta.createMany({
    data: metas.map((m) => ({
      unidadeId: destino.unidadeId,
      versaoPropostaId: destinoVersaoId,
      numero: m.numero,
      nome: m.nome,
      valor: m.valor,
      status: m.status,
      observacao: m.observacao,
      criadoPor,
    })),
  });
}
