'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { falha } from '@/shared/kernel';
import { recalcular } from './calculo-linhas';
import { entradaBruta } from './entrada-exercicio';

// "Recalcular" na visão do orçamento (R9). Volta à visão do exercício com o aviso.
export const recalcularAcao = definirAcao({ funcionalidade: 'orc.orcamento', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  if (typeof e['exercicioId'] !== 'string') return falha([{ campo: '_', mensagem: 'Exercício inválido. Recarregue a tela.' }]);
  const r = await recalcular(ctx, e['exercicioId']);
  if (!r.ok) return r;
  redirect(`/orc/orcamento?ano=${r.valor.ano}&aviso=recalculado`);
});
