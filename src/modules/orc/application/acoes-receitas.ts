'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { entradaBruta } from './entrada-exercicio';
import { alterarReceita, excluirReceita, incluirReceita } from './receitas';

// Ações da tela de receitas (US-060). Depois do sucesso, voltam à lista do exercício com o aviso.
export const incluirReceitaAcao = definirAcao({ funcionalidade: 'orc.receitas', acao: 'incluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await incluirReceita(ctx, e);
  if (!r.ok) return r;
  redirect(`/orc/receitas?ano=${r.valor.ano}&aviso=incluida`);
});

export const alterarReceitaAcao = definirAcao({ funcionalidade: 'orc.receitas', acao: 'alterar', entrada: entradaBruta }, async (e, ctx) => {
  const r = await alterarReceita(ctx, e);
  if (!r.ok) return r;
  redirect(`/orc/receitas?ano=${r.valor.ano}&aviso=alterada`);
});

export const excluirReceitaAcao = definirAcao({ funcionalidade: 'orc.receitas', acao: 'excluir', entrada: entradaBruta }, async (e, ctx) => {
  const r = await excluirReceita(ctx, e);
  if (!r.ok) return r;
  redirect(`/orc/receitas?ano=${r.valor.ano}&aviso=excluida`);
});
