'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarAgrupador, excluirAgrupador, incluirAgrupador } from './agrupadores';

// Server Actions dos agrupadores de contas (US-047). A negação (403) é auditada pela definirAcao (C5).
const ROTA = '/cad/plano-contas/agrupadores';
const id = z.string().max(40);
const nome = z.string().max(200);
const contaIds = z.array(z.string().max(40)).max(5000);
const depois = <T extends { ok: boolean }>(r: T) => {
  if (r.ok) revalidatePath(ROTA);
  return r;
};

export const acaoIncluirAgrupador = definirAcao(
  { funcionalidade: 'cad.plano_contas', acao: 'executar', entrada: z.object({ nome, contaIds }).strict() },
  async (e, ctx) => depois(await incluirAgrupador(ctx, e)),
);

export const acaoAlterarAgrupador = definirAcao(
  { funcionalidade: 'cad.plano_contas', acao: 'executar', entrada: z.object({ id, versao: z.number().int(), nome, contaIds }).strict() },
  async (e, ctx) => depois(await alterarAgrupador(ctx, e.id, e.versao, { nome: e.nome, contaIds: e.contaIds })),
);

export const acaoExcluirAgrupador = definirAcao(
  { funcionalidade: 'cad.plano_contas', acao: 'executar', entrada: z.object({ id, versao: z.number().int() }).strict() },
  async (e, ctx) => depois(await excluirAgrupador(ctx, e.id, e.versao)),
);
