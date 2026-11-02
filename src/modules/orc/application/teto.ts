import { z } from 'zod';
import { auditar } from '@/shared/audit';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { Dinheiro, falha, ok, type Resultado } from '@/shared/kernel';
import { editavel } from '../domain/exercicio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { lerValor } from '../domain/planilha';
import { validarTeto } from '../domain/resultado';
import { valorDaTela } from '../domain/valor-tela';
import { contextoAuditoria, errosNaoEditavel, travarExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { exigirSemEscopo } from './escopo';
import { CAMPOS_ORIGEM_BLINDADA, recusarCamposBlindados } from './governanca';

// Teto manual do exercício (US-059; orc.orcamento:alterar; D-P6-2). Valor vazio volta ao teto
// padrão (receita confirmada). Só sem escopo (R15) e com o exercício editável.
const entrada = z
  .object({
    exercicioId: z.string(),
    versao: z.coerce.number().int().min(0),
    teto: z.string().optional(),
    justificativa: z.string().max(1000).optional(),
  })
  .strict();

export async function definirTeto(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsOrc> = {}): Promise<Resultado<{ ano: number }>> {
  exigir(ctx, 'orc.orcamento', 'alterar');
  const deps = resolverDeps(depsParciais);
  await exigirSemEscopo(deps.cliente, ctx, deps, 'orc.orcamento', 'alterar');
  await recusarCamposBlindados(ctx, 'orc.orcamento', bruto, CAMPOS_ORIGEM_BLINDADA.exercicio, deps);
  const e = entrada.safeParse(bruto);
  if (!e.success) return falha([{ campo: '_', mensagem: 'Dados do teto inválidos. Recarregue a tela.' }]);
  const lido = lerValor(valorDaTela(e.data.teto ?? ''));
  if (lido === 'INVALIDO') return falha([{ campo: 'teto', mensagem: MENSAGENS_ORC.VALOR_FORMATO }]);
  return deps.cliente.$transaction(async (tx) => {
    const ex = await travarExercicio(tx, e.data.exercicioId);
    if (ex.versao !== e.data.versao) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.ALTERADO_POR_OUTRO }]);
    if (!editavel(ex.situacao)) return falha(errosNaoEditavel(ex.situacao));
    const receitas = await tx.receitaRateio.findMany({ where: { exercicioId: ex.id, situacao: 'CONFIRMADO' }, select: { total: true } });
    const receitaConfirmada = Dinheiro.somarTodos(receitas.map((r) => Dinheiro.de(r.total.toString())));
    const v = validarTeto(lido, e.data.justificativa ?? null, receitaConfirmada);
    if (!v.ok) return v;
    const antes = await tx.orcamentoExercicio.findUniqueOrThrow({ where: { id: ex.id }, select: { tetoManual: true, tetoJustificativa: true } });
    await tx.orcamentoExercicio.update({
      where: { id: ex.id },
      data: { tetoManual: v.valor.valor?.paraString() ?? null, tetoJustificativa: v.valor.justificativa, versao: { increment: 1 }, atualizadoEm: deps.agora() },
    });
    await auditar(tx, {
      contexto: contextoAuditoria(ctx),
      funcionalidade: 'orc.orcamento',
      tipo: 'ALTERACAO',
      registroId: ex.id,
      descricao: v.valor.valor === null ? `Teto do exercício ${ex.ano} volta ao padrão (receita confirmada)` : `Teto manual do exercício ${ex.ano} definido`,
      antes: { tetoManual: antes.tetoManual === null ? null : Dinheiro.de(antes.tetoManual.toString()), justificativa: antes.tetoJustificativa },
      depois: { tetoManual: v.valor.valor, justificativa: v.valor.justificativa },
    });
    return ok({ ano: ex.ano });
  });
}
