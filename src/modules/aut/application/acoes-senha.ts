'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { nomeCookieSessao, opcoesCookieSessao } from '@/shared/config';
import { trocarSenha } from './trocar-senha';

const texto = z.string().max(200, 'A senha deve ter no máximo 128 caracteres');

// Troca de senha (US-030). O token novo vai só para o cookie; o resultado nunca o carrega.
export const trocar = definirAcao(
  {
    funcionalidade: 'aut.senha',
    acao: 'alterar',
    entrada: z.object({ senhaAtual: texto.optional(), novaSenha: texto, repetirSenha: texto }),
  },
  async (e, ctx) => {
    const r = await trocarSenha(ctx, e);
    if (!r.ok) return r;
    (await cookies()).set(nomeCookieSessao(), r.valor.token, opcoesCookieSessao(r.valor.expiraEm));
    redirect('/inicio');
  },
);
