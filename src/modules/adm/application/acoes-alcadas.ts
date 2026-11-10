'use server';

import { redirect } from 'next/navigation';
import { definirAcao } from '@/shared/authz';
import { alterarAlcada, cadastrarAlcada, inativarAlcada } from './alcadas';
import { entradaAlteracaoAlcada, entradaCadastroAlcada, entradaExclusaoAlcada } from './entrada-alcada';

// Ações das telas de alçadas (US-042). Depois do sucesso, voltam à listagem com o aviso.
const FUNCIONALIDADE = 'adm.alcadas';

export const incluirAlcada = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'incluir', entrada: entradaCadastroAlcada }, async (e, ctx) => {
  const r = await cadastrarAlcada(ctx, e);
  if (!r.ok) return r;
  redirect('/adm/alcadas?aviso=cadastrada');
});

export const trocarAprovadores = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'alterar', entrada: entradaAlteracaoAlcada }, async (e, ctx) => {
  const r = await alterarAlcada(ctx, e.id, e.versao, e.dados);
  if (!r.ok) return r;
  redirect('/adm/alcadas?aviso=alterada');
});

export const excluirAlcada = definirAcao({ funcionalidade: FUNCIONALIDADE, acao: 'excluir', entrada: entradaExclusaoAlcada }, async (e, ctx) => {
  const r = await inativarAlcada(ctx, e.id, e.versao);
  if (!r.ok) return r;
  redirect('/adm/alcadas?aviso=excluida');
});
