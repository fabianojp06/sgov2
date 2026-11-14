import { z } from 'zod';
import { MENSAGENS_ALCADA, resolverAprovador } from '@/modules/adm/servidor';
import { criarSolicitacao, pendenteDoAlvo, type Manipulador } from '@/modules/apr';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { ConflitoConcorrencia, Dinheiro, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { CategoriaProposta } from '../domain/proposta';
import { custoDaViagem } from '../domain/viagem';
import { contextoAuditoria } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { aprovadoresDoFluxo, type AprovadoresDoLote } from './lote-pessoal';
import { travarVersao, ultimaVersao, uuid } from './pessoal-comum';

// Validação das viagens (US-081; UC6.02, fluxo WA02; plano do P28, Task 1). O Operador de Viagens pede a validação
// das viagens Pendentes ou Rejeitadas da versão Oficializada (D-P28-2, D-P28-3); elas vão num lote Em Validação,
// travadas, e a solicitação é roteada pela alçada WA02. O manipulador, na Central de Tarefas, valida (as viagens
// passam a entrar no cronograma, passo 4) ou rejeita (as linhas voltam a poder ser enviadas, FA-A).

const FUNCIONALIDADE = 'orc.viagens';
export type SituacaoViagem = 'PENDENTE' | 'EM_VALIDACAO' | 'VALIDADO' | 'REJEITADO';

/** D-P28-8: a situação da linha é a do último lote em que ela foi enviada; sem lote, Pendente. */
export const situacaoDaViagem = (lote: { situacao: string } | null | undefined): SituacaoViagem => (lote?.situacao as SituacaoViagem | undefined) ?? 'PENDENTE';

/** RF_VAL_REQ_001: o titular e o substituto do WA02 para o modal, ou o motivo de o botão não caber (E2 e E4). */
export async function validadoresDasViagens(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<AprovadoresDoLote> {
  exigir(ctx, FUNCIONALIDADE, 'executar');
  return aprovadoresDoFluxo(resolverDeps(depsParciais), 'WA02', ctx.usuarioId);
}

const entrada = z.object({ propostaId: z.string(), versaoCapa: z.coerce.number().int().min(0) }).strict();
const concorrente = () => falha([{ campo: '_', mensagem: M.VIAGENS_CONCORRENTE }]);

/**
 * UC6.02 passos 1 e 2 (D-P28-5): a varredura junta as falhas (versão Oficializada, nenhum lote em validação,
 * alguma viagem a enviar, aprovador WA02); sem falha, o lote nasce Em Validação com as viagens e a solicitação é
 * roteada. A capa sobe: o segundo a pedir recebe o E3.
 */
export async function solicitarValidacaoViagens(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const parse = entrada.safeParse(bruto);
  if (!parse.success || !uuid.safeParse(parse.data.propostaId).success) return falha([{ campo: '_', mensagem: M.VIAGEM_DADOS_INVALIDOS }]);
  const { propostaId, versaoCapa } = parse.data;
  try {
    return await emUnidade(
      ctx,
      async (tx) => {
        const p = await tx.propostaTp.findFirst({ where: { id: propostaId, excluidaEm: null }, include: { unidade: { select: { codigo: true } }, versoes: ultimaVersao } });
        const v = p?.versoes[0];
        if (!p || !v) return falha([{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }]);
        if (p.versao !== versaoCapa) return concorrente();
        const viagens = await tx.viagemProposta.findMany({ where: { versaoPropostaId: v.id }, select: { id: true, loteViagem: { select: { situacao: true } } } });
        const situacoes = viagens.map((x) => situacaoDaViagem(x.loteViagem));
        const aEnviar = viagens.filter((_, i) => situacoes[i] === 'PENDENTE' || situacoes[i] === 'REJEITADO').map((x) => x.id);
        const erros: ErroCampo[] = [];
        if (v.situacao !== 'OFICIALIZADO') erros.push({ campo: '_', mensagem: M.VIAGENS_SO_OFICIALIZADA });
        if (situacoes.includes('EM_VALIDACAO')) erros.push({ campo: '_', mensagem: M.VIAGENS_EM_VALIDACAO });
        else if (aEnviar.length === 0) erros.push({ campo: '_', mensagem: M.VIAGENS_SEM_PENDENTES });
        const aprovador = await resolverAprovador(tx, 'WA02', { solicitanteId: ctx.usuarioId });
        if (!aprovador) erros.push({ campo: '_', mensagem: MENSAGENS_ALCADA.SEM_APROVADOR('WA02') });
        else if ('bloqueio' in aprovador) erros.push({ campo: '_', mensagem: MENSAGENS_ALCADA.MESMO_USUARIO('WA02') });
        if (erros.length > 0 || !aprovador || 'bloqueio' in aprovador) return falha(erros);
        await travarVersao(tx, {
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

        const lote = await tx.loteViagem.create({ data: { unidadeId: p.unidadeId, versaoPropostaId: v.id, solicitadoPor: ctx.usuarioId }, select: { id: true } });
        const ligadas = await tx.viagemProposta.updateMany({ where: { id: { in: aEnviar }, versaoPropostaId: v.id }, data: { loteViagemId: lote.id } });
        if (ligadas.count !== aEnviar.length || (await pendenteDoAlvo(tx, lote.id))) throw new ConflitoConcorrencia();
        await criarSolicitacao(
          tx,
          {
            fluxo: 'WA02',
            alvoTipo: 'LOTE_VIAGEM',
            alvoId: lote.id,
            unidadeId: p.unidadeId,
            descricao: `Viagens do TP ${p.unidade.codigo} · Versão ${v.numero}`,
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
          registroId: lote.id,
          descricao: `Validação de ${aEnviar.length} viagem(ns) da versão ${v.numero} da proposta do TP ${p.unidade.codigo} pedida (WA02)`,
          antes: { situacao: 'PENDENTE' },
          depois: { situacao: 'EM_VALIDACAO', viagens: aEnviar, aprovador: aprovador.papel },
        });
        return ok({ numero: p.unidade.codigo });
      },
      { cliente: deps.cliente },
    );
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia) return concorrente();
    throw erro;
  }
}

const alvoMudou = () => falha([{ campo: '_', mensagem: M.WA02_ALVO_MUDOU }]);

/**
 * O manipulador do WA02 para a Central de Tarefas (D-P28-6): validar leva o lote a Validado (as viagens passam a
 * entrar no cronograma, passo 4); rejeitar o leva a Rejeitado, e as viagens podem ser enviadas de novo.
 */
export function manipuladorWa02(): Manipulador {
  const mudar = async (tx: TxCliente, loteId: string, para: 'VALIDADO' | 'REJEITADO', ctx: ContextoRequisicao, descricao: (tp: string, v: number) => string, extra: Record<string, unknown> = {}) => {
    const l = await tx.loteViagem.findFirst({
      where: { id: loteId },
      include: { versaoProposta: { include: { proposta: { include: { unidade: { select: { codigo: true } } } } } } },
    });
    if (!l || l.situacao !== 'EM_VALIDACAO') return alvoMudou();
    exigirUmaLinha(await tx.loteViagem.updateMany({ where: { id: loteId, versao: l.versao, situacao: 'EM_VALIDACAO' }, data: { situacao: para, versao: { increment: 1 } } }));
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: l.unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: loteId,
      descricao: descricao(l.versaoProposta.proposta.unidade.codigo, l.versaoProposta.numero),
      antes: { situacao: 'EM_VALIDACAO' },
      depois: { situacao: para, ...extra },
    });
    return ok(null);
  };
  return {
    aoAprovar: (tx, s, ctx) => mudar(tx, s.alvoId, 'VALIDADO', ctx, (tp, v) => `HOMOLOGACAO_VIAGENS: viagens da versão ${v} da proposta do TP ${tp} validadas`),
    aoRejeitar: (tx, s, justificativa, ctx) =>
      mudar(tx, s.alvoId, 'REJEITADO', ctx, (tp, v) => `REJEICAO_VIAGENS: viagens da versão ${v} da proposta do TP ${tp} devolvidas para ajuste`, { justificativa }),
    async resumo(tx, s) {
      const viagens = await tx.viagemProposta.findMany({ where: { loteViagemId: s.alvoId } });
      const porConta = new Map<string, Dinheiro>();
      const somar = (conta: string | null, v: Dinheiro) => {
        if (conta && !v.ehZero()) porConta.set(conta, (porConta.get(conta) ?? Dinheiro.zero()).somar(v));
      };
      for (const v of viagens) {
        const c = custoDaViagem({
          pessoas: v.pessoas,
          dias: v.dias,
          valorPassagem: Dinheiro.de(v.valorPassagem.toString()),
          valorDiaria: Dinheiro.de(v.valorDiaria.toString()),
          valorTransporte: Dinheiro.de(v.valorTransporte.toString()),
        });
        somar(v.contaPassagem, c.passagem);
        somar(v.contaDiaria, c.diaria);
        somar(v.contaTransporte, c.transporte);
      }
      return [
        { rotulo: 'Viagens', valor: String(viagens.length) },
        ...[...porConta]
          .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }))
          .map(([conta, valor]) => ({ rotulo: `Conta ${conta}`, valor: valor.formatar() })),
        { rotulo: 'Custo das viagens', valor: Dinheiro.somarTodos([...porConta.values()]).formatar() },
      ];
    },
  };
}
