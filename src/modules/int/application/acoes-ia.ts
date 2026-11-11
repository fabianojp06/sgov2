'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarCasoUsoIA, alterarConfiguracaoIA, FUNCIONALIDADE_IA, pedirAvaliacaoIA } from './ia';

// Server Actions do cadastro da IA (US-019 parte 2). A negação (403) é auditada pela definirAcao
// (C5); o conflito de versão volta como erro geral. O FormData vira objeto aqui; o caso de uso
// valida com o schema estrito.
const comoObjeto = (v: unknown) => (v instanceof FormData ? Object.fromEntries([...v.keys()].map((k) => [k, v.get(k)])) : v);
const entrada = z.preprocess(comoObjeto, z.record(z.string(), z.unknown()));

export const acaoAlterarConfiguracaoIA = definirAcao({ funcionalidade: FUNCIONALIDADE_IA, acao: 'alterar', entrada }, async (e, ctx) => {
  const r = await alterarConfiguracaoIA(ctx, e);
  if (r.ok) revalidatePath('/int/ia');
  return r;
});

export const acaoAlterarCasoUsoIA = definirAcao({ funcionalidade: FUNCIONALIDADE_IA, acao: 'alterar', entrada }, async (e, ctx) => {
  const r = await alterarCasoUsoIA(ctx, e);
  if (r.ok) revalidatePath('/int/ia');
  return r;
});

export const acaoPedirAvaliacaoIA = definirAcao({ funcionalidade: FUNCIONALIDADE_IA, acao: 'alterar', entrada }, async (e, ctx) => {
  const r = await pedirAvaliacaoIA(ctx, e);
  if (r.ok) revalidatePath('/int/ia');
  return r;
});
