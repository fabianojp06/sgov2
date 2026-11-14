import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { FluxoAprovacao } from '@/modules/adm';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma, type TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, exigirUmaLinha, falha, ok, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { MENSAGENS_APR as M, validarJustificativa, type SituacaoSolicitacao } from '../domain/solicitacao';

// Solicitações de aprovação e Central de Tarefas (US-078; Aprovações V2, UC6.00 a UC6.02; plano do P26, Task 1).
// O `apr` registra o pedido e a decisão; o efeito no alvo (oficializar a proposta, por exemplo) é do módulo dono
// do fluxo, que entra como manipulador injetado pela página (o `apr` não importa o `orc`). A decisão e o efeito
// vão na mesma transação (RNF_WA01_004): se o manipulador recusa, nada fica gravado.

const FUNCIONALIDADE = 'apr.tarefas';

export type DepsApr = { cliente: PrismaClient; agora: () => Date };
const resolver = (d: Partial<DepsApr> = {}): DepsApr => ({ cliente: d.cliente ?? prisma, agora: d.agora ?? (() => new Date()) });

export type SolicitacaoDecidivel = {
  id: string;
  fluxo: FluxoAprovacao;
  alvoTipo: string;
  alvoId: string;
  unidadeId: string;
  descricao: string;
  solicitanteId: string;
  aprovadorId: string;
};

export type ItemResumo = { rotulo: string; valor: string };

/** O efeito de um fluxo no alvo. A recusa (Resultado com erro) desfaz a decisão. */
export type Manipulador = {
  aoAprovar(tx: TxCliente, s: SolicitacaoDecidivel, ctx: ContextoRequisicao): Promise<Resultado<null>>;
  aoRejeitar(tx: TxCliente, s: SolicitacaoDecidivel, justificativa: string, ctx: ContextoRequisicao): Promise<Resultado<null>>;
  /** O que o aprovador vê ao abrir a tarefa (só leitura). */
  resumo?(tx: TxCliente, s: SolicitacaoDecidivel, ctx: ContextoRequisicao): Promise<readonly ItemResumo[]>;
};
export type Manipuladores = Partial<Record<FluxoAprovacao, Manipulador>>;

export type DadosSolicitacao = {
  fluxo: FluxoAprovacao;
  alvoTipo: string;
  alvoId: string;
  unidadeId: string;
  descricao: string;
  solicitanteId: string;
  aprovadorId: string;
  papelAprovador: 'TITULAR' | 'SUBSTITUTO';
};

/**
 * D-P26-4: registra o pedido na transação de quem submete e vincula o aprovador à unidade do alvo, para a RLS
 * deixá-lo ler o alvo e a solicitação [PROVISÓRIO]. **Limite de confiança:** `aprovadorId` e `papelAprovador`
 * vêm sempre do `resolverAprovador` (a alçada), e `unidadeId` da unidade do alvo, nunca da entrada do usuário: o
 * vínculo dá acesso à unidade inteira pela RLS (revisão 12.12). O vínculo sobe a versão do usuário (a sessão
 * recarrega as unidades), como o do criador da proposta (D-P17-3). Uma só EM_APROVACAO por alvo: o índice único
 * recusa a segunda (RN_WA01_009).
 */
export async function criarSolicitacao(tx: TxCliente, d: DadosSolicitacao, agora: Date): Promise<{ id: string }> {
  const vinculo = await tx.usuarioUnidade.findFirst({ where: { usuarioId: d.aprovadorId, unidadeId: d.unidadeId }, select: { usuarioId: true } });
  if (!vinculo) {
    await tx.usuarioUnidade.create({ data: { usuarioId: d.aprovadorId, unidadeId: d.unidadeId } });
    await tx.usuario.updateMany({ where: { id: d.aprovadorId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  }
  return tx.solicitacaoAprovacao.create({ data: d, select: { id: true } });
}

/** RN_WA01_009: há pedido Em Aprovação para o alvo. */
export async function pendenteDoAlvo(tx: TxCliente, alvoId: string): Promise<boolean> {
  return (await tx.solicitacaoAprovacao.count({ where: { alvoId, situacao: 'EM_APROVACAO' } })) > 0;
}

export type TarefaTela = {
  id: string;
  fluxo: FluxoAprovacao;
  descricao: string;
  solicitante: string;
  papelAprovador: 'TITULAR' | 'SUBSTITUTO';
  situacao: SituacaoSolicitacao;
  enviadaEm: Date;
  decididaEm: Date | null;
  justificativa: string | null;
  versao: number;
};

export type FiltrosTarefas = { situacao?: string | undefined; de?: string | undefined; ate?: string | undefined; tp?: string | undefined };

// O dia do filtro é o de Brasília, como a data que a tela mostra (o mesmo do filtro do Histórico, revisão 12.12).
const dia = (t: string | undefined) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00.000-03:00`) : null);

/** RF_APR_REQ_002: as tarefas do usuário como aprovador (pendentes primeiro), com os filtros de situação, período e TP. */
export async function listarTarefas(ctx: ContextoRequisicao, filtros: FiltrosTarefas = {}, depsParciais: Partial<DepsApr> = {}): Promise<readonly TarefaTela[]> {
  const deps = resolver(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  const de = dia(filtros.de);
  const ate = dia(filtros.ate);
  const situacao = ['EM_APROVACAO', 'APROVADO', 'REJEITADO'].includes(filtros.situacao ?? '') ? filtros.situacao : undefined;
  const linhas = await emUnidade(
    ctx,
    (tx) =>
      tx.solicitacaoAprovacao.findMany({
        where: {
          aprovadorId: ctx.usuarioId,
          ...(situacao ? { situacao } : {}),
          ...(de || ate ? { enviadaEm: { ...(de ? { gte: de } : {}), ...(ate ? { lt: new Date(ate.getTime() + 86_400_000) } : {}) } } : {}),
          ...(filtros.tp?.trim() ? { descricao: { contains: filtros.tp.trim(), mode: 'insensitive' as const } } : {}),
        },
        include: { solicitante: { select: { nome: true } } },
        orderBy: { enviadaEm: 'desc' },
        take: 500,
      }),
    { cliente: deps.cliente },
  );
  const ordem = (s: string) => (s === 'EM_APROVACAO' ? 0 : 1);
  return linhas
    .map((s) => ({
      id: s.id,
      fluxo: s.fluxo as FluxoAprovacao,
      descricao: s.descricao,
      solicitante: s.solicitante.nome,
      papelAprovador: s.papelAprovador as 'TITULAR' | 'SUBSTITUTO',
      situacao: s.situacao as SituacaoSolicitacao,
      enviadaEm: s.enviadaEm,
      decididaEm: s.decididaEm,
      justificativa: s.justificativa,
      versao: s.versao,
    }))
    .sort((a, b) => ordem(a.situacao) - ordem(b.situacao));
}

const decidivel = (s: {
  id: string;
  fluxo: string;
  alvoTipo: string;
  alvoId: string;
  unidadeId: string;
  descricao: string;
  solicitanteId: string;
  aprovadorId: string;
}): SolicitacaoDecidivel => ({
  id: s.id,
  fluxo: s.fluxo as FluxoAprovacao,
  alvoTipo: s.alvoTipo,
  alvoId: s.alvoId,
  unidadeId: s.unidadeId,
  descricao: s.descricao,
  solicitanteId: s.solicitanteId,
  aprovadorId: s.aprovadorId,
});

/** A tarefa aberta, com o resumo do alvo pelo manipulador do fluxo; nula se não é do usuário. */
export async function obterTarefa(
  ctx: ContextoRequisicao,
  id: string,
  manipuladores: Manipuladores,
  depsParciais: Partial<DepsApr> = {},
): Promise<{ tarefa: TarefaTela; resumo: readonly ItemResumo[] } | null> {
  const deps = resolver(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'consultar');
  if (!z.uuid().safeParse(id).success) return null;
  return emUnidade(
    ctx,
    async (tx) => {
      const s = await tx.solicitacaoAprovacao.findFirst({ where: { id, aprovadorId: ctx.usuarioId }, include: { solicitante: { select: { nome: true } } } });
      if (!s) return null;
      const m = manipuladores[s.fluxo as FluxoAprovacao];
      const resumo = m?.resumo ? await m.resumo(tx, decidivel(s), ctx) : [];
      return {
        tarefa: {
          id: s.id,
          fluxo: s.fluxo as FluxoAprovacao,
          descricao: s.descricao,
          solicitante: s.solicitante.nome,
          papelAprovador: s.papelAprovador as 'TITULAR' | 'SUBSTITUTO',
          situacao: s.situacao as SituacaoSolicitacao,
          enviadaEm: s.enviadaEm,
          decididaEm: s.decididaEm,
          justificativa: s.justificativa,
          versao: s.versao,
        },
        resumo,
      };
    },
    { cliente: deps.cliente },
  );
}

const entradaDecisao = z
  .object({
    id: z.string(),
    versao: z.coerce.number().int().min(0),
    decisao: z.enum(['APROVAR', 'REJEITAR']),
    justificativa: z.string().optional(),
    // A justificativa veio da ajuda da IA e não foi alterada (US-084, D-P30-6): o Histórico marca a origem.
    sugestaoIa: z.literal('true').optional(),
  })
  .strict();

/** A recusa do manipulador, levada para fora da transação para desfazê-la. */
class RecusaDoManipulador extends Error {
  constructor(readonly resultado: Resultado<never>) {
    super('recusa do manipulador');
  }
}

/**
 * UC6.00 passos 5 e FA-A (D-P26-5): só o aprovador roteado decide; a rejeição exige justificativa (RN_WA01_006);
 * a decisão e o efeito no alvo vão juntos. Decisão concorrente: a mensagem do E6.
 */
export async function decidirSolicitacao(
  ctx: ContextoRequisicao,
  bruto: unknown,
  manipuladores: Manipuladores,
  depsParciais: Partial<DepsApr> = {},
): Promise<Resultado<{ descricao: string; decisao: 'APROVAR' | 'REJEITAR' }>> {
  const deps = resolver(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const parse = entradaDecisao.safeParse(bruto);
  if (!parse.success || !z.uuid().safeParse(parse.data.id).success) return falha([{ campo: '_', mensagem: M.DADOS_INVALIDOS }]);
  const { id, versao, decisao } = parse.data;
  const justificativa = decisao === 'REJEITAR' ? validarJustificativa(parse.data.justificativa) : null;
  if (justificativa && !justificativa.ok) return justificativa;
  try {
    return await emUnidade(
      ctx,
      async (tx) => {
        const s = await tx.solicitacaoAprovacao.findFirst({ where: { id } });
        if (!s) return falha([{ campo: '_', mensagem: M.INEXISTENTE }]);
        if (s.aprovadorId !== ctx.usuarioId) return falha([{ campo: '_', mensagem: M.NAO_E_APROVADOR }]);
        if (s.situacao !== 'EM_APROVACAO' || s.versao !== versao) return falha([{ campo: '_', mensagem: M.CONCORRENTE }]);
        const m = manipuladores[s.fluxo as FluxoAprovacao];
        if (!m) return falha([{ campo: '_', mensagem: M.SEM_MANIPULADOR }]);

        const situacao: SituacaoSolicitacao = decisao === 'APROVAR' ? 'APROVADO' : 'REJEITADO';
        const texto = justificativa?.ok ? justificativa.valor : null;
        exigirUmaLinha(
          await tx.solicitacaoAprovacao.updateMany({
            where: { id, versao, situacao: 'EM_APROVACAO' },
            data: { situacao, justificativa: texto, decididaEm: deps.agora(), versao: { increment: 1 } },
          }),
        );
        const efeito = decisao === 'APROVAR' ? await m.aoAprovar(tx, decidivel(s), ctx) : await m.aoRejeitar(tx, decidivel(s), texto!, ctx);
        if (!efeito.ok) throw new RecusaDoManipulador(efeito);
        await auditar(tx, {
          contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: ctx.usuarioRotulo, sessaoUid: ctx.sessaoUid, ip: ctx.ip, unidadeId: s.unidadeId },
          funcionalidade: FUNCIONALIDADE,
          tipo: 'ALTERACAO',
          registroId: id,
          ...(decisao === 'REJEITAR' && parse.data.sugestaoIa === 'true' ? { origem: 'SUGESTAO_IA' as const } : {}),
          descricao: `Solicitação ${s.fluxo} "${s.descricao}" ${decisao === 'APROVAR' ? 'aprovada' : 'rejeitada'}`,
          antes: { situacao: 'EM_APROVACAO' },
          depois: { situacao, ...(texto ? { justificativa: texto } : {}) },
        });
        return ok({ descricao: s.descricao, decisao });
      },
      { cliente: deps.cliente },
    );
  } catch (erro) {
    if (erro instanceof RecusaDoManipulador) return erro.resultado;
    if (erro instanceof ConflitoConcorrencia) return falha([{ campo: '_', mensagem: M.CONCORRENTE }]);
    throw erro;
  }
}
