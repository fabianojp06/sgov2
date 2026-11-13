import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaDe, competenciaParaTexto, type Competencias } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { metaExigida } from '../domain/meta';
import { SITUACOES_VERSIONAVEIS, TIPOS_PROPOSTA, type CategoriaProposta, type SituacaoProposta, type TipoProposta } from '../domain/proposta';
import type { DepsOrc } from './deps';
import { metasParaLancamento } from './metas';

// Peças comuns dos empregados e dos quantitativos da proposta (US-070; plano do P20). As duas telas mexem na
// última versão de cada proposta, em Rascunho ou Em Elaboração (RN0183, RN0159, D-P20-7). Como nas metas
// (P19), toda operação sobe a versão da capa, e toda recusa vem antes: a recusa é um Resultado, e a
// transação seria confirmada com a capa subida.

const SITUACOES_EDITAVEIS: readonly string[] = SITUACOES_VERSIONAVEIS;
export const ultimaVersao = { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } as const;
export const uuid = z.uuid();

export const alterado = () => falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);

// Lançamento com vínculo (viagem da US-071): a FK recusa o DELETE (RN0254, RN0145).
export const violouVinculo = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') || (e instanceof Error && /\b23503\b/.test(e.message));
// Ordem repetida na corrida (o índice NULLS NOT DISTINCT): a trava da capa barra antes; o índice é a segunda barreira.
const violouUnicidade = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || (e instanceof Error && /\b23505\b/.test(e.message));

export const contem = (alvo: string, termo: string | undefined) => !termo || alvo.toLocaleLowerCase('pt-BR').includes(termo.trim().toLocaleLowerCase('pt-BR'));
export const porNumero = (a: { numero: string }, b: { numero: string }) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true });

export type FiltrosPessoal = { tipo?: string | undefined; proposta?: string | undefined; meta?: string | undefined };
export const tipoDoFiltro = (tipo: string | undefined) => ((TIPOS_PROPOSTA as readonly string[]).includes(tipo ?? '') ? tipo : undefined);

/** O cabeçalho comum dos blocos das duas telas (um por proposta, RN0146). */
export type CabecalhoBloco = {
  propostaId: string;
  numero: string;
  objeto: string;
  tipo: TipoProposta;
  categoria: CategoriaProposta;
  versaoNumero: number;
  situacao: SituacaoProposta;
  /** Versão em Rascunho ou Em Elaboração. */
  editavel: boolean;
  /** Versão de concorrência da capa: vai em toda operação. */
  versaoCapa: number;
  /** Vigência em competências ("AAAA-MM"), para os limites do formulário. */
  vigencia: { inicio: string; fim: string };
  /** As metas ativas da versão, para a escolha no formulário (RN_VIA_04); vazio na Consolidada. */
  metas: readonly { id: string; numero: string; nome: string }[];
};

type CapaLida = {
  id: string;
  objeto: string;
  tipo: string;
  categoria: string;
  inicio: Date;
  fim: Date;
  versao: number;
  unidade: { codigo: string };
};

export function cabecalho(p: CapaLida, v: { numero: number; situacao: string }, metasAtivas: CabecalhoBloco['metas']): CabecalhoBloco {
  return {
    propostaId: p.id,
    numero: p.unidade.codigo,
    objeto: p.objeto,
    tipo: p.tipo as TipoProposta,
    categoria: p.categoria as CategoriaProposta,
    versaoNumero: v.numero,
    situacao: v.situacao as SituacaoProposta,
    editavel: SITUACOES_EDITAVEIS.includes(v.situacao),
    versaoCapa: p.versao,
    vigencia: { inicio: competenciaParaTexto(competenciaDe(p.inicio)), fim: competenciaParaTexto(competenciaDe(p.fim)) },
    metas: metasAtivas,
  };
}

/** A proposta e a última versão dela, conferidas e ainda sem trava. */
export type VersaoLida = {
  propostaId: string;
  versaoCapa: number;
  unidadeId: string;
  numeroTp: string;
  versaoId: string;
  versaoNumero: number;
  situacao: string;
  categoria: CategoriaProposta;
  vigencia: Competencias;
};

/**
 * Confere a proposta (existe, versão da capa, última versão editável e, no alterar e no excluir, o registro
 * nessa versão). Não trava: o caso de uso termina as conferências dele e só então chama travarVersao.
 */
export async function lerVersaoEditavel(
  tx: TxCliente,
  propostaId: string,
  versaoCapa: number,
  imutavel: string,
  versaoDoRegistro?: string,
): Promise<Resultado<VersaoLida>> {
  if (!uuid.safeParse(propostaId).success) return falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  const p = await tx.propostaTp.findFirst({ where: { id: propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } }, versoes: ultimaVersao } });
  if (!p) return falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
  if (p.versao !== versaoCapa) return alterado();
  const v = p.versoes[0];
  if (!v || !SITUACOES_EDITAVEIS.includes(v.situacao)) return falha([{ campo: '_', mensagem: imutavel }]);
  // O registro de versão anterior fica como estava.
  if (versaoDoRegistro !== undefined && versaoDoRegistro !== v.id) return falha([{ campo: '_', mensagem: imutavel }]);
  return ok({
    propostaId,
    versaoCapa,
    unidadeId: p.unidadeId,
    numeroTp: p.unidade.codigo,
    versaoId: v.id,
    versaoNumero: v.numero,
    situacao: v.situacao,
    categoria: p.categoria as CategoriaProposta,
    vigencia: { inicio: p.inicio, fim: p.fim },
  });
}

/** Trava a capa (sobe a versão dela) e confere que a última versão não mudou; senão, conflito. */
export async function travarVersao(tx: TxCliente, lida: VersaoLida): Promise<void> {
  exigirUmaLinha(
    await tx.propostaTp.updateMany({ where: { id: lida.propostaId, versao: lida.versaoCapa, excluidaEm: null }, data: { versao: { increment: 1 } } }),
  );
  const agora = await tx.versaoProposta.findFirst({ where: { propostaId: lida.propostaId }, ...ultimaVersao });
  if (agora?.id !== lida.versaoId || agora.situacao !== lida.situacao) throw new ConflitoConcorrencia();
}

/**
 * RN0245 e RN_VIA_04 (D-P19-7, D-P20-2): na categoria Meta, uma meta ativa da versão é obrigatória; na
 * Consolidada, nenhuma. Devolve a meta escolhida (ou nula).
 */
export async function resolverMeta(
  tx: TxCliente,
  lida: VersaoLida,
  metaId: string | undefined,
): Promise<Resultado<{ id: string; numero: string } | null>> {
  const escolhida = metaId?.trim() ?? '';
  if (!metaExigida(lida.categoria)) return escolhida === '' ? ok(null) : falha([{ campo: 'metaId', mensagem: M.META_SEM_CATEGORIA }]);
  if (escolhida === '') return falha([{ campo: 'metaId', mensagem: M.EMPREGADO_META_OBRIGATORIA }]);
  const meta = (await metasParaLancamento(tx, lida.versaoId)).find((m) => m.id === escolhida);
  return meta ? ok({ id: meta.id, numero: meta.numero }) : falha([{ campo: 'metaId', mensagem: M.EMPREGADO_META_INVALIDA }]);
}

/** A transação com a unidade, com o conflito e a corrida de ordem em ALTERADO_POR_OUTRO. */
export async function executarPessoal<T>(ctx: ContextoRequisicao, deps: DepsOrc, corpo: (tx: TxCliente) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await emUnidade(ctx, corpo, { cliente: deps.cliente });
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia || violouUnicidade(erro)) return alterado();
    throw erro;
  }
}

/** As metas da versão (todas, para nomear os grupos) e as ativas (para o formulário). */
export async function metasDaVersao(tx: TxCliente, versaoId: string) {
  const todas = await tx.metaProposta.findMany({ where: { versaoPropostaId: versaoId }, select: { id: true, numero: true, nome: true, status: true } });
  return { todas: todas.sort(porNumero), ativas: todas.filter((m) => m.status === 'ATIVO').sort(porNumero).map(({ id, numero, nome }) => ({ id, numero, nome })) };
}
