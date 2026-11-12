'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarNomeExibicao } from './instituicao';

// Server Action do nome de exibição da instituição (#434). A negação (403) é auditada pela definirAcao (C5).
const entrada = z
  .object({
    nome: z.string().max(500, 'Use no máximo 120 caracteres.'),
    anterior: z.string().max(500),
  })
  .strict();

export const acaoAlterarNomeExibicao = definirAcao({ funcionalidade: 'cad.instituicao', acao: 'alterar', entrada }, async (e, ctx) => {
  const r = await alterarNomeExibicao(ctx, e);
  if (r.ok) revalidatePath('/cad/instituicao');
  return r;
});
