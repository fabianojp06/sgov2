'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { definirSituacaoUnidade, incluirUnidade, renomearUnidade } from './estrutura-funcional';

// Server Actions da estrutura funcional (US-048). A negação (403) é auditada pela definirAcao (C5).
const ROTA = '/cad/estrutura-funcional';
const id = z.string().max(40);
const versao = z.number().int();

export const acaoIncluirUnidade = definirAcao(
  {
    funcionalidade: 'cad.estrutura_funcional',
    acao: 'incluir',
    entrada: z.object({ nome: z.string().max(500), tipo: z.string().max(20), superiorId: id.nullable() }).strict(),
  },
  async (e, ctx) => {
    const r = await incluirUnidade(ctx, e);
    if (r.ok) revalidatePath(ROTA);
    return r;
  },
);

export const acaoRenomearUnidade = definirAcao(
  { funcionalidade: 'cad.estrutura_funcional', acao: 'alterar', entrada: z.object({ id, versao, nome: z.string().max(500) }).strict() },
  async (e, ctx) => {
    const r = await renomearUnidade(ctx, e.id, e.versao, e.nome);
    if (r.ok) revalidatePath(ROTA);
    return r;
  },
);

export const acaoDefinirSituacaoUnidade = definirAcao(
  { funcionalidade: 'cad.estrutura_funcional', acao: 'alterar', entrada: z.object({ id, versao, ativa: z.boolean() }).strict() },
  async (e, ctx) => {
    const r = await definirSituacaoUnidade(ctx, e.id, e.versao, e.ativa);
    if (r.ok) revalidatePath(ROTA);
    return r;
  },
);
