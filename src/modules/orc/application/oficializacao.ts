import { z } from 'zod';
import { MENSAGENS_ALCADA, resolverAprovador } from '@/modules/adm/servidor';
import { criarSolicitacao, pendenteDoAlvo, type Manipulador, type SolicitacaoDecidivel } from '@/modules/apr';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { competenciaParaTexto } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { competenciasDaVigencia } from '../domain/rateio';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { totaisDaVersao } from './totalizadores';

// Oficialização da proposta de TP (US-079; UC03.10 e UC6.00, fluxo WA01; plano do P26, Task 2). O orçamentista
// avança a versão de Rascunho para Em Elaboração e a envia; a varredura junta todas as falhas (D-P26-3); o envio
// roteia pela alçada e registra a solicitação no apr. O efeito da decisão (oficializar com o snapshot, ou voltar
// para Em Elaboração) é o manipulador do WA01, que a Central de Tarefas recebe pela página.

const FUNCIONALIDADE = 'orc.propostas';
const entrada = z.object({ id: z.string(), versao: z.coerce.number().int().min(0) }).strict();
const uuid = z.uuid();
const dadosInvalidos = () => falha([{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }]);
const inexistente = () => falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);

async function lerUltima(tx: TxCliente, id: string) {
  return tx.propostaTp.findFirst({
    where: { id, excluidaEm: null },
    include: { unidade: { select: { codigo: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true, numero: true, situacao: true } } },
  });
}

async function executar<T>(ctx: ContextoRequisicao, deps: DepsOrc, corpo: (tx: TxCliente) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await emUnidade(ctx, corpo, { cliente: deps.cliente });
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    // A corrida do envio: o índice único parcial da solicitação (RN_WA01_009, Review Focus 1).
    if (erro instanceof Error && /\b23505\b|P2002/.test(`${(erro as { code?: string }).code ?? ''} ${erro.message}`)) return falha([{ campo: '_', mensagem: M.ENVIO_JA_EM_APROVACAO }]);
    throw erro;
  }
}

/** Sobe a versão da capa e muda a situação da última versão, de `de` para `para` (o gatilho confere a transição). */
async function mudarSituacao(tx: TxCliente, propostaId: string, versaoCapa: number, versaoId: string, de: string, para: string) {
  exigirUmaLinha(await tx.propostaTp.updateMany({ where: { id: propostaId, versao: versaoCapa, excluidaEm: null }, data: { versao: { increment: 1 } } }));
  exigirUmaLinha(await tx.versaoProposta.updateMany({ where: { id: versaoId, situacao: de }, data: { situacao: para } }));
}

/** UC03.10 (D-P26-2): a última versão em Rascunho vai para Em Elaboração. */
export async function avancarProposta(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const parse = entrada.safeParse(bruto);
  if (!parse.success || !uuid.safeParse(parse.data.id).success) return dadosInvalidos();
  const { id, versao } = parse.data;
  return executar(ctx, deps, async (tx) => {
    const p = await lerUltima(tx, id);
    const v = p?.versoes[0];
    if (!p || !v) return inexistente();
    if (p.versao !== versao) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    if (v.situacao !== 'RASCUNHO') return falha([{ campo: '_', mensagem: M.AVANCO_SO_RASCUNHO }]);
    await mudarSituacao(tx, id, versao, v.id, 'RASCUNHO', 'EM_ELABORACAO');
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: v.id,
      descricao: `Versão ${v.numero} da proposta do TP ${p.unidade.codigo} avançada para Em Elaboração`,
      antes: { situacao: 'RASCUNHO' },
      depois: { situacao: 'EM_ELABORACAO' },
    });
    return ok({ numero: p.unidade.codigo });
  });
}

/**
 * RN_WA01_002 e C1 (D-P26-3): com grade de rateio, cada linha tem todas as competências da vigência declaradas
 * (o zero digitado conta; a vazia não). Devolve os detalhes por conta.
 */
async function rateioEmBranco(tx: TxCliente, versaoId: string, competencias: readonly string[]): Promise<string[]> {
  const g = await tx.rateioProposta.findUnique({ where: { versaoPropostaId: versaoId }, include: { celulas: { select: { conta: true, competencia: true } } } });
  if (!g) return [];
  const porConta = new Map<string, Set<string>>();
  for (const c of g.celulas) porConta.set(c.conta, (porConta.get(c.conta) ?? new Set()).add(competenciaParaTexto(c.competencia)));
  return [...porConta.entries()]
    .map(([conta, declaradas]) => [conta, competencias.filter((c) => !declaradas.has(c))] as const)
    .filter(([, faltam]) => faltam.length > 0)
    .map(([conta, faltam]) => M.ENVIO_CELULAS_EM_BRANCO_DETALHE(conta, faltam.map((c) => `${c.slice(5, 7)}/${c.slice(0, 4)}`).join(', ')));
}

/** D-P26-1 [PROVISÓRIO no lugar do sincronismo com o ERP, E2]: as contas usadas são analíticas ativas do C1. */
async function contasForaDoPlano(tx: TxCliente, deps: DepsOrc, versaoId: string): Promise<string[]> {
  const indice = await deps.estruturaCompleta.carregarIndiceEstrutura(deps.cliente);
  const [viagens, bens, celulas] = await Promise.all([
    tx.viagemProposta.findMany({ where: { versaoPropostaId: versaoId }, select: { contaPassagem: true, contaDiaria: true, contaTransporte: true } }),
    tx.bemProposta.findMany({ where: { versaoPropostaId: versaoId, ativo: true }, select: { conta: true } }),
    tx.rateioCelulaProposta.findMany({ where: { rateio: { versaoPropostaId: versaoId } }, select: { conta: true } }),
  ]);
  const usadas = new Set([...viagens.flatMap((v) => [v.contaPassagem, v.contaDiaria, ...(v.contaTransporte ? [v.contaTransporte] : [])]), ...bens.map((b) => b.conta), ...celulas.map((c) => c.conta)]);
  return [...usadas].filter((c) => !indice.contaAnaliticaAtiva(c)).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

/** O envio está disponível? (RF_APR_REQ_001 e 006): para mostrar ou desabilitar o botão, com o motivo. */
export async function disponibilidadeDoEnvio(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<{ disponivel: true } | { disponivel: false; motivo: string }> {
  const deps = resolverDeps(depsParciais);
  const r = await deps.cliente.$transaction((tx) => resolverAprovador(tx, 'WA01', { solicitanteId: ctx.usuarioId }));
  if (!r) return { disponivel: false, motivo: MENSAGENS_ALCADA.SEM_APROVADOR('WA01') };
  if ('bloqueio' in r) return { disponivel: false, motivo: MENSAGENS_ALCADA.MESMO_USUARIO('WA01') };
  return { disponivel: true };
}

/**
 * UC6.00 passos 1 a 3 (D-P26-3 e D-P26-4): a varredura junta todas as falhas; sem falha, a versão vai a Em
 * Aprovação e a solicitação é roteada pela alçada (titular, ou o substituto se o titular está indisponível).
 */
export async function enviarPropostaWa01(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'incluir');
  const parse = entrada.safeParse(bruto);
  if (!parse.success || !uuid.safeParse(parse.data.id).success) return dadosInvalidos();
  const { id, versao } = parse.data;
  return executar(ctx, deps, async (tx) => {
    const p = await lerUltima(tx, id);
    const v = p?.versoes[0];
    if (!p || !v) return inexistente();
    if (p.versao !== versao) return falha([{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }]);
    const erros: ErroCampo[] = [];
    if (v.situacao !== 'EM_ELABORACAO') erros.push({ campo: '_', mensagem: M.ENVIO_STATUS_INVALIDO });
    const aprovador = await resolverAprovador(tx, 'WA01', { solicitanteId: ctx.usuarioId });
    if (!aprovador) erros.push({ campo: '_', mensagem: MENSAGENS_ALCADA.SEM_APROVADOR('WA01') });
    else if ('bloqueio' in aprovador) erros.push({ campo: '_', mensagem: MENSAGENS_ALCADA.MESMO_USUARIO('WA01') });
    if (await pendenteDoAlvo(tx, v.id)) erros.push({ campo: '_', mensagem: M.ENVIO_JA_EM_APROVACAO });
    const emBranco = await rateioEmBranco(tx, v.id, competenciasDaVigencia(p.inicio, p.fim));
    if (emBranco.length > 0) erros.push({ campo: '_', mensagem: M.ENVIO_CELULAS_EM_BRANCO }, ...emBranco.map((mensagem) => ({ campo: '_', mensagem })));
    const fora = await contasForaDoPlano(tx, deps, v.id);
    if (fora.length > 0) erros.push({ campo: '_', mensagem: M.ENVIO_CONTA_INATIVA(fora.join(', ')) });
    if (erros.length > 0 || !aprovador || 'bloqueio' in aprovador) return falha(erros);

    await mudarSituacao(tx, id, versao, v.id, 'EM_ELABORACAO', 'EM_APROVACAO');
    const descricao = `TP ${p.unidade.codigo} · Versão ${v.numero}`;
    const s = await criarSolicitacao(
      tx,
      {
        fluxo: 'WA01',
        alvoTipo: 'VERSAO_PROPOSTA',
        alvoId: v.id,
        unidadeId: p.unidadeId,
        descricao,
        solicitanteId: ctx.usuarioId,
        aprovadorId: aprovador.usuarioId,
        papelAprovador: aprovador.papel,
      },
      deps.agora(),
    );
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: p.unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: v.id,
      descricao: `Versão ${v.numero} da proposta do TP ${p.unidade.codigo} enviada para oficialização (WA01, solicitação ${s.id})`,
      antes: { situacao: 'EM_ELABORACAO' },
      depois: { situacao: 'EM_APROVACAO', aprovador: aprovador.papel },
    });
    return ok({ numero: p.unidade.codigo });
  });
}

/** A versão alvo da solicitação, ainda Em Aprovação e a última da proposta; senão, nula. */
async function alvoEmAprovacao(tx: TxCliente, s: SolicitacaoDecidivel) {
  const v = await tx.versaoProposta.findFirst({ where: { id: s.alvoId }, include: { proposta: { include: { unidade: { select: { codigo: true } }, versoes: { orderBy: { numero: 'desc' }, take: 1, select: { id: true } } } } } });
  return v && v.situacao === 'EM_APROVACAO' && v.proposta.versoes[0]?.id === v.id ? v : null;
}

const alvoMudou = () => falha([{ campo: '_', mensagem: M.WA01_ALVO_MUDOU }]);

/**
 * O manipulador do WA01 para a Central de Tarefas (D-P26-6 e D-P26-7). Aprovar: snapshot com o Valor Global e os
 * totais por conta (com o pessoal: o aprovador homologa o orçamento inteiro [PROVISÓRIO]) e a versão Oficializada.
 * Rejeitar: a versão volta para Em Elaboração. Os dois sobem a capa e vão ao Histórico.
 */
export function manipuladorWa01(depsParciais: Partial<DepsOrc> = {}): Manipulador {
  const deps = resolverDeps(depsParciais);
  return {
    async aoAprovar(tx, s, ctx) {
      const v = await alvoEmAprovacao(tx, s);
      if (!v) return alvoMudou();
      const t = await totaisDaVersao(tx, deps, v.id, true);
      await tx.snapshotVersao.create({
        data: {
          unidadeId: v.unidadeId,
          versaoPropostaId: v.id,
          valorGlobal: t.total.paraString(),
          contas: Object.fromEntries([...t.porConta].map(([conta, valor]) => [conta, valor.paraString()])),
          geradoPor: ctx.usuarioId,
        },
      });
      await mudarSituacao(tx, v.propostaId, v.proposta.versao, v.id, 'EM_APROVACAO', 'OFICIALIZADO');
      await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId: v.unidadeId },
        funcionalidade: FUNCIONALIDADE,
        tipo: 'ALTERACAO',
        registroId: v.id,
        descricao: `HOMOLOGACAO_OFICIAL: versão ${v.numero} da proposta do TP ${v.proposta.unidade.codigo} oficializada (Valor Global ${t.total.formatar()})`,
        antes: { situacao: 'EM_APROVACAO' },
        depois: { situacao: 'OFICIALIZADO', valorGlobal: t.total.paraString() },
      });
      return ok(null);
    },
    async aoRejeitar(tx, s, justificativa, ctx) {
      const v = await alvoEmAprovacao(tx, s);
      if (!v) return alvoMudou();
      await mudarSituacao(tx, v.propostaId, v.proposta.versao, v.id, 'EM_APROVACAO', 'EM_ELABORACAO');
      await auditar(tx, {
        contexto: { ...contextoAuditoria(ctx), unidadeId: v.unidadeId },
        funcionalidade: FUNCIONALIDADE,
        tipo: 'ALTERACAO',
        registroId: v.id,
        descricao: `REJEICAO_WORKFLOW: versão ${v.numero} da proposta do TP ${v.proposta.unidade.codigo} devolvida para Em Elaboração`,
        antes: { situacao: 'EM_APROVACAO' },
        depois: { situacao: 'EM_ELABORACAO', justificativa },
      });
      return ok(null);
    },
    async resumo(tx, s) {
      const v = await tx.versaoProposta.findFirst({ where: { id: s.alvoId }, include: { proposta: true } });
      if (!v) return [];
      const t = await totaisDaVersao(tx, deps, v.id, true);
      return [
        { rotulo: 'Objeto', valor: v.proposta.objeto },
        { rotulo: 'Vigência', valor: `${v.proposta.inicio.toISOString().slice(0, 10).split('-').reverse().join('/')} a ${v.proposta.fim.toISOString().slice(0, 10).split('-').reverse().join('/')}` },
        { rotulo: 'Valor Global', valor: t.total.formatar() },
        { rotulo: 'Contas com valor', valor: String(t.porConta.size) },
        ...(t.avisos.length > 0 ? [{ rotulo: 'Avisos', valor: t.avisos.join(' ') }] : []),
      ];
    },
  };
}
