'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { alterarImposto, incluirAliquota, incluirImposto, removerAliquotaFutura } from './impostos';

// Server Actions dos impostos (US-052). A negação (403) é auditada pela definirAcao (C5).
const ROTA = '/cad/impostos';
const id = z.string().max(40);
const texto = z.string().max(100);
const depois = <T extends { ok: boolean }>(r: T) => {
  if (r.ok) revalidatePath(ROTA);
  return r;
};

export const acaoIncluirImposto = definirAcao(
  { funcionalidade: 'cad.impostos', acao: 'incluir', entrada: z.object({ nome: texto, incidencia: texto }).strict() },
  async (e, ctx) => depois(await incluirImposto(ctx, e)),
);

export const acaoAlterarImposto = definirAcao(
  { funcionalidade: 'cad.impostos', acao: 'alterar', entrada: z.object({ id, versao: z.number().int(), nome: texto, incidencia: texto, ativo: z.boolean() }).strict() },
  async (e, ctx) => depois(await alterarImposto(ctx, e.id, e.versao, { nome: e.nome, incidencia: e.incidencia, ativo: e.ativo })),
);

export const acaoIncluirAliquota = definirAcao(
  { funcionalidade: 'cad.impostos', acao: 'alterar', entrada: z.object({ impostoId: id, competencia: texto, percentual: texto }).strict() },
  async (e, ctx) => depois(await incluirAliquota(ctx, e.impostoId, { competencia: e.competencia, percentual: e.percentual })),
);

export const acaoRemoverAliquota = definirAcao(
  { funcionalidade: 'cad.impostos', acao: 'alterar', entrada: z.object({ impostoId: id, competencia: texto }).strict() },
  async (e, ctx) => depois(await removerAliquotaFutura(ctx, e.impostoId, e.competencia)),
);
