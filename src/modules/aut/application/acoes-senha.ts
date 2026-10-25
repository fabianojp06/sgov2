'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { nomeCookieSessao, opcoesCookieSessao } from '@/shared/config';
import { falha } from '@/shared/kernel';
import { trocarSenha } from './trocar-senha';

const texto = z.string().max(128, 'A senha deve ter no máximo 128 caracteres');

// Troca de senha (US-030). O token novo vai só para o cookie; o resultado nunca o carrega.
export const trocar = definirAcao(
  {
    funcionalidade: 'aut.senha',
    acao: 'alterar',
    entrada: z.object({ senhaAtual: texto.optional(), novaSenha: texto, repetirSenha: texto }),
  },
  async (e, ctx) => {
    const r = await trocarSenha(ctx, e);
    // falha(r.erros): o tipo garante que o token nunca vai na resposta.
    if (!r.ok) return falha(r.erros);
    (await cookies()).set(nomeCookieSessao(), r.valor.token, opcoesCookieSessao(r.valor.expiraEm));
    redirect('/inicio');
  },
);
