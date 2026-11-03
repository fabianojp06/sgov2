'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { lerEnvAcesso, nomeCookieUnidade } from '@/shared/config';
import { ok } from '@/shared/kernel';
import { validarTrocaUnidade } from './tela-principal';

// Troca de TP (§6.7): só uma unidade da lista do usuário; fora dela, a guarda audita a negação.
export const trocarUnidade = definirAcao(
  { funcionalidade: 'aut.unidade', acao: 'alterar', entrada: z.object({ unidadeId: z.uuid('Unidade inválida') }) },
  async (e, ctx) => {
    await validarTrocaUnidade(ctx, e.unidadeId);
    const env = lerEnvAcesso();
    (await cookies()).set(nomeCookieUnidade(env), e.unidadeId, { httpOnly: true, sameSite: 'lax', path: '/', secure: env.seguro });
    revalidatePath('/', 'layout');
    return ok(undefined);
  },
);
