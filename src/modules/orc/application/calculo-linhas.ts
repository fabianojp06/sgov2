import { z } from 'zod';
import { auditar, type ContextoAuditoria } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, ErroDominio, falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import { editavel, ROTULO_SITUACAO, type SituacaoExercicio } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { calcularPacote } from '../domain/pacote';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';

// Cálculo das linhas do orçamento (plano do P6, Task 2; R3, R4 e R9). Todo cálculo refaz o
// exercício inteiro na mesma transação, com as premissas atuais do C2: nenhuma linha fica com
// outra versão das premissas.

export type ResumoRecalculo = { posicoes: number; pacotes: number; linhas: number; versaoPremissas: number; avisos: readonly string[] };

export type ExercicioTravado = { id: string; ano: number; situacao: SituacaoExercicio; versao: number; versaoPremissas: number | null };

// Primeira coisa de toda escrita no exercício: a trava de linha (FOR UPDATE) antes de qualquer
// outra escrita, porque os triggers leem o exercício com FOR SHARE (evita o deadlock entre duas
// escritas). O id fora do formato uuid é um exercício que não existe.
export async function travarExercicio(tx: TxCliente, id: string): Promise<ExercicioTravado> {
  if (!z.uuid().safeParse(id).success) throw inexistente();
  const [e] = await tx.$queryRaw<ExercicioTravado[]>`
    SELECT id, ano, situacao, versao, versao_premissas AS "versaoPremissas"
    FROM orc_exercicio WHERE id = ${id}::uuid FOR UPDATE`;
  if (!e) throw inexistente();
  return e;
}

const inexistente = () => new ErroDominio('orc.exercicio_inexistente', 'Exercício não encontrado.');

export const errosNaoEditavel = (s: SituacaoExercicio) => [{ campo: '_', mensagem: MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(ROTULO_SITUACAO[s]) }];

// Erro de cálculo ou de situação dentro da transação: lançar (e não devolver um Resultado) desfaz
// tudo o que quem chamou já gravou, como as posições da cópia e da importação. O caso de uso
// converte em Resultado de falha fora da transação.
export class ErroRecalculo extends ErroDominio {
  constructor(readonly erros: readonly ErroCampo[]) {
    super('orc.recalculo_invalido', erros.map((e) => e.mensagem).join(' '));
    this.name = 'ErroRecalculo';
  }
}

// A Adm. Central não é unidade: o Histórico do orc nunca leva o TP escolhido no seletor.
export const contextoAuditoria = (ctx: ContextoRequisicao): ContextoAuditoria => ({
  usuarioId: ctx.usuarioId,
  usuarioRotulo: ctx.usuarioRotulo,
  sessaoUid: ctx.sessaoUid,
  ip: ctx.ip,
  unidadeId: null,
});

const dinheiro = (v: { toString(): string }) => Dinheiro.de(v.toString());
const textos = (xs: readonly Dinheiro[]) => xs.map((x) => x.paraString());

// Interno ao módulo, dentro da transação de quem chama. Trava o exercício (repetir o FOR UPDATE na
// mesma transação não espera), confere a situação e lança ErroRecalculo em vez de devolver falha.
export async function recalcularExercicio(tx: TxCliente, exercicioId: string, deps: DepsOrc): Promise<ResumoRecalculo> {
  const e = await travarExercicio(tx, exercicioId);
  if (!editavel(e.situacao)) throw new ErroRecalculo(errosNaoEditavel(e.situacao));
  const premissas = await deps.custoPessoal.obterPremissasExercicio(tx, e.ano);
  if (!premissas) throw new ErroDominio('orc.premissas_inexistentes', `O exercício ${e.ano} não tem premissas.`);
  const [posicoes, pacotes] = await Promise.all([
    tx.posicaoOrcada.findMany({ where: { exercicioId }, orderBy: { id: 'asc' } }),
    tx.pacoteBaseZero.findMany({ where: { exercicioId }, orderBy: { id: 'asc' } }),
  ]);

  // Tudo calculado antes de qualquer escrita: com um erro, nada é gravado.
  const linhas: { cc: string; conta: string; origem: 'PESSOAL' | 'BASE_ZERO'; componente: string | null; posicaoId: string | null; pacoteId: string | null; meses: string[]; total: string }[] = [];
  for (const p of posicoes) {
    const r = deps.custoPessoal.calcularCustoPosicao(
      { quantidade: p.quantidade, salarioMensal: dinheiro(p.salarioMensal), mesInicio: p.mesInicio, mesSaida: p.mesSaida },
      premissas,
    );
    if (!r.ok) {
      throw new ErroRecalculo(r.erros.map((erro) => ({ campo: `posicoes.${p.id}.${erro.campo}`, mensagem: `CC ${p.cc}, cargo ${p.cargo}: ${erro.mensagem}` })));
    }
    for (const l of r.valor.linhas) {
      linhas.push({ cc: p.cc, conta: l.conta, origem: 'PESSOAL', componente: l.componente, posicaoId: p.id, pacoteId: null, meses: textos(l.meses), total: l.total.paraString() });
    }
  }
  for (const k of pacotes) {
    const { valorAnual, meses } = calcularPacote(
      {
        quantidade: k.quantidade,
        valorUnitario: dinheiro(k.valorUnitario),
        corrigirIpca: k.corrigirIpca,
        distribuicao: k.distribuicao as 'MENSAL' | 'PONTUAL',
        mesOcorrencia: k.mesOcorrencia,
      },
      premissas.ipca,
    );
    linhas.push({ cc: k.cc, conta: k.conta, origem: 'BASE_ZERO', componente: null, posicaoId: null, pacoteId: k.id, meses: textos(meses), total: valorAnual.paraString() });
  }

  await tx.linhaOrcada.deleteMany({ where: { exercicioId } });
  await tx.linhaOrcada.createMany({ data: linhas.map((l) => ({ ...l, exercicioId })) });
  await tx.orcamentoExercicio.update({
    where: { id: exercicioId },
    data: { versaoPremissas: premissas.versao, versao: { increment: 1 }, atualizadoEm: deps.agora() },
  });
  return { posicoes: posicoes.length, pacotes: pacotes.length, linhas: linhas.length, versaoPremissas: premissas.versao, avisos: premissas.avisos };
}

// "Recalcular" (orc.orcamento:alterar; R9): refaz as linhas com as premissas atuais e audita a
// versão das premissas antes e depois. Ordem: permissão, escopo total (R15) e só então a trava.
export async function recalcular(
  ctx: ContextoRequisicao,
  exercicioId: string,
  depsParciais: Partial<DepsOrc> = {},
): Promise<Resultado<ResumoRecalculo & { mensagem: string }>> {
  exigir(ctx, 'orc.orcamento', 'alterar');
  const deps = resolverDeps(depsParciais);
  try {
    return await deps.cliente.$transaction(async (tx) => {
      await exigirSemEscopo(tx, ctx, deps, 'orc.orcamento', 'alterar');
      const e = await travarExercicio(tx, exercicioId);
      const r = await recalcularExercicio(tx, e.id, deps);
      await auditar(tx, {
        contexto: contextoAuditoria(ctx),
        funcionalidade: 'orc.orcamento',
        tipo: 'ALTERACAO',
        registroId: e.id,
        descricao: `Orçamento ${e.ano} recalculado`,
        antes: { versaoPremissas: e.versaoPremissas },
        depois: { versaoPremissas: r.versaoPremissas, linhas: r.linhas },
      });
      return ok({ ...r, mensagem: MENSAGENS_ORC.RECALCULADO });
    });
  } catch (erro) {
    if (erro instanceof ErroRecalculo) return falha(erro.erros);
    throw erro;
  }
}
