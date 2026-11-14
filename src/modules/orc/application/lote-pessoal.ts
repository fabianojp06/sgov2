import { z } from 'zod';
import { MENSAGENS_ALCADA, resolverAprovador } from '@/modules/adm/servidor';
import { criarSolicitacao, pendenteDoAlvo, type Manipulador } from '@/modules/apr';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, ConflitoConcorrencia, exigirUmaLinha, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { CATEGORIAS_EMPREGADO, ROTULO_CATEGORIA_EMPREGADO } from '../domain/empregado';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { contextoAuditoria } from './calculo-linhas';
import { cacheAnos, custoDoEmpregado } from './custo-empregado';
import { carregarCargos } from './custo-posicao';
import { resolverDeps, type DepsOrc } from './deps';
import { lerVersaoEditavel, travarVersao } from './pessoal-comum';

// Lote de pessoal para homologação (US-080; UC6.01, fluxo WA05; plano do P27, Task 1). O analista do GRH finaliza
// os lançamentos de pessoal da versão; o lote vai a Em Aprovação (as telas de pessoal ficam só leitura) e a
// solicitação é roteada pela alçada WA05. O manipulador, na Central de Tarefas, homologa (o pessoal passa a
// entrar no cronograma) ou devolve o lote para edição.

const FUNCIONALIDADE = 'orc.empregados';
export type SituacaoLote = 'EM_ELABORACAO' | 'EM_APROVACAO' | 'HOMOLOGADO';

/** A situação do lote de pessoal da versão (sem linha: Em Elaboração). */
export async function situacaoDoLote(tx: TxCliente, versaoId: string): Promise<SituacaoLote> {
  const l = await tx.lotePessoal.findUnique({ where: { versaoPropostaId: versaoId }, select: { situacao: true } });
  return (l?.situacao as SituacaoLote | undefined) ?? 'EM_ELABORACAO';
}

export type AprovadoresDoLote = { titular: string; substituto: string } | { motivo: string };

/**
 * RF_APR_REQ_007: o titular e o substituto da alçada WA05, para o modal (só leitura). Sem aprovador disponível,
 * ou com o próprio solicitante roteado (RN_WA02_006), o motivo no lugar do botão, como no envio do WA01.
 */
export async function aprovadoresDoLote(ctx: ContextoRequisicao, depsParciais: Partial<DepsOrc> = {}): Promise<AprovadoresDoLote> {
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const deps = resolverDeps(depsParciais);
  return deps.cliente.$transaction(async (tx) => {
    const r = await resolverAprovador(tx, 'WA05', { solicitanteId: ctx.usuarioId });
    if (!r) return { motivo: MENSAGENS_ALCADA.SEM_APROVADOR('WA05') };
    if ('bloqueio' in r) return { motivo: MENSAGENS_ALCADA.MESMO_USUARIO('WA05') };
    const a = await tx.alcadaAprovacao.findFirst({
      where: { fluxo: 'WA05', ativa: true },
      select: { titular: { select: { nome: true, login: true } }, substituto: { select: { nome: true } } },
    });
    return a ? { titular: `${a.titular.nome} (${a.titular.login})`, substituto: a.substituto.nome } : { motivo: MENSAGENS_ALCADA.SEM_APROVADOR('WA05') };
  });
}

const entrada = z.object({ propostaId: z.string(), versaoCapa: z.coerce.number().int().min(0) }).strict();

/**
 * UC6.01 passos 2 a 5 (D-P27-3): a varredura junta as falhas (versão editável, lote ainda em elaboração, algum
 * empregado, aprovador WA05); sem falha, o lote vai a Em Aprovação e a solicitação é roteada (o aprovador vem da
 * alçada; a unidade, da proposta). A capa sobe: o segundo a finalizar recebe o E3.
 */
export async function finalizarLotePessoal(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ numero: string }>> {
  const deps = resolverDeps(depsParciais);
  exigir(ctx, FUNCIONALIDADE, 'executar');
  const parse = entrada.safeParse(bruto);
  if (!parse.success) return falha([{ campo: '_', mensagem: M.EMPREGADO_DADOS_INVALIDOS }]);
  try {
    return await emUnidade(
      ctx,
      async (tx) => {
        const lida = await lerVersaoEditavel(tx, parse.data.propostaId, parse.data.versaoCapa, M.EMPREGADO_VERSAO_IMUTAVEL);
        if (!lida.ok) return lida.erros[0]?.mensagem === M.ALTERADO_POR_OUTRO ? falha([{ campo: '_', mensagem: M.LOTE_CONCORRENTE }]) : lida;
        const { versaoId, unidadeId, numeroTp, versaoNumero } = lida.valor;
        const erros: ErroCampo[] = [];
        if ((await situacaoDoLote(tx, versaoId)) !== 'EM_ELABORACAO') erros.push({ campo: '_', mensagem: M.LOTE_JA_FINALIZADO });
        if ((await tx.empregadoProposta.count({ where: { versaoPropostaId: versaoId } })) === 0) erros.push({ campo: '_', mensagem: M.LOTE_SEM_EMPREGADOS });
        const aprovador = await resolverAprovador(tx, 'WA05', { solicitanteId: ctx.usuarioId });
        if (!aprovador) erros.push({ campo: '_', mensagem: MENSAGENS_ALCADA.SEM_APROVADOR('WA05') });
        else if ('bloqueio' in aprovador) erros.push({ campo: '_', mensagem: MENSAGENS_ALCADA.MESMO_USUARIO('WA05') });
        if (erros.length > 0 || !aprovador || 'bloqueio' in aprovador) return falha(erros);
        await travarVersao(tx, lida.valor);

        const lote = await tx.lotePessoal.upsert({
          where: { versaoPropostaId: versaoId },
          create: { unidadeId, versaoPropostaId: versaoId, situacao: 'EM_APROVACAO', finalizadoPor: ctx.usuarioId },
          update: { situacao: 'EM_APROVACAO', finalizadoPor: ctx.usuarioId, versao: { increment: 1 } },
          select: { id: true },
        });
        if (await pendenteDoAlvo(tx, lote.id)) throw new ConflitoConcorrencia();
        await criarSolicitacao(
          tx,
          {
            fluxo: 'WA05',
            alvoTipo: 'LOTE_PESSOAL',
            alvoId: lote.id,
            unidadeId,
            descricao: `Pessoal do TP ${numeroTp} · Versão ${versaoNumero}`,
            solicitanteId: ctx.usuarioId,
            aprovadorId: aprovador.usuarioId,
            papelAprovador: aprovador.papel,
          },
          deps.agora(),
        );
        await auditar(tx, {
          contexto: { ...contextoAuditoria(ctx), unidadeId },
          funcionalidade: FUNCIONALIDADE,
          tipo: 'ALTERACAO',
          registroId: lote.id,
          descricao: `Pessoal da versão ${versaoNumero} da proposta do TP ${numeroTp} finalizado e enviado para homologação (WA05)`,
          antes: { situacao: 'EM_ELABORACAO' },
          depois: { situacao: 'EM_APROVACAO', aprovador: aprovador.papel },
        });
        return ok({ numero: numeroTp });
      },
      { cliente: deps.cliente },
    );
  } catch (erro) {
    if (erro instanceof ConflitoConcorrencia) return falha([{ campo: '_', mensagem: M.LOTE_CONCORRENTE }]);
    if (erro instanceof Error && /\b23505\b|P2002/.test(`${(erro as { code?: string }).code ?? ''} ${erro.message}`)) return falha([{ campo: '_', mensagem: M.LOTE_CONCORRENTE }]);
    throw erro;
  }
}

const alvoMudou = () => falha([{ campo: '_', mensagem: M.WA05_ALVO_MUDOU }]);

/**
 * O manipulador do WA05 para a Central de Tarefas (D-P27-4, D-P27-6, D-P27-7): homologar leva o lote a
 * Homologado (o pessoal passa a entrar no cronograma, RN_WA05_005); rejeitar o devolve a Em Elaboração.
 */
export function manipuladorWa05(depsParciais: Partial<DepsOrc> = {}): Manipulador {
  const deps = resolverDeps(depsParciais);
  const mudar = async (
    tx: TxCliente,
    loteId: string,
    para: SituacaoLote,
    ctx: ContextoRequisicao,
    descricao: (tp: string, v: number) => string,
    extra: Record<string, unknown> = {},
  ) => {
    const l = await tx.lotePessoal.findFirst({
      where: { id: loteId },
      include: { versaoProposta: { include: { proposta: { include: { unidade: { select: { codigo: true } } } } } } },
    });
    if (!l || l.situacao !== 'EM_APROVACAO') return alvoMudou();
    exigirUmaLinha(await tx.lotePessoal.updateMany({ where: { id: loteId, versao: l.versao, situacao: 'EM_APROVACAO' }, data: { situacao: para, versao: { increment: 1 } } }));
    await auditar(tx, {
      contexto: { ...contextoAuditoria(ctx), unidadeId: l.unidadeId },
      funcionalidade: FUNCIONALIDADE,
      tipo: 'ALTERACAO',
      registroId: loteId,
      descricao: descricao(l.versaoProposta.proposta.unidade.codigo, l.versaoProposta.numero),
      antes: { situacao: 'EM_APROVACAO' },
      depois: { situacao: para, ...extra },
    });
    return ok(null);
  };
  return {
    aoAprovar: (tx, s, ctx) => mudar(tx, s.alvoId, 'HOMOLOGADO', ctx, (tp, v) => `HOMOLOGACAO_PESSOAL: pessoal da versão ${v} da proposta do TP ${tp} homologado`),
    aoRejeitar: (tx, s, justificativa, ctx) =>
      mudar(tx, s.alvoId, 'EM_ELABORACAO', ctx, (tp, v) => `REJEICAO_PESSOAL: pessoal da versão ${v} da proposta do TP ${tp} devolvido para edição`, { justificativa }),
    async resumo(tx, s) {
      const l = await tx.lotePessoal.findFirst({ where: { id: s.alvoId }, select: { versaoPropostaId: true } });
      if (!l) return [];
      const empregados = await tx.empregadoProposta.findMany({ where: { versaoPropostaId: l.versaoPropostaId } });
      const anos = cacheAnos(await carregarCargos(tx, deps));
      let total = Dinheiro.zero();
      const avisos = new Set<string>();
      for (const e of empregados) {
        const c = await custoDoEmpregado(tx, deps, anos, { ...e, salarioMensal: Dinheiro.de(e.salarioMensal.toString()) });
        total = total.somar(c.periodo);
        for (const a of [...c.avisos, ...c.erros]) avisos.add(a);
      }
      return [
        ...CATEGORIAS_EMPREGADO.map((cat) => ({ rotulo: ROTULO_CATEGORIA_EMPREGADO[cat], valor: String(empregados.filter((e) => e.categoria === cat).length) })),
        { rotulo: 'Custo do pessoal no período', valor: total.formatar() },
        ...(avisos.size > 0 ? [{ rotulo: 'Avisos', valor: [...avisos].join(' ') }] : []),
      ];
    },
  };
}
