import 'server-only';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { paraNoTela, paraNoTelaCc, type NoCcTela, type NoContaTela } from '../domain/arvore-tela';
import { listarArvoreCentrosCusto, listarArvoreContas } from '../infrastructure/estrutura-financeira';

// Consultas em árvore, só leitura: plano de contas (US-044, Task 7b; C27, RN_PLA_001) e centros de
// custo (US-046 parte 2, Task 8).

/** A árvore inteira, com as inativas (a tela só as mostra com "Mostrar inativas"). */
export async function consultarArvoreContas(ctx: ContextoRequisicao, deps: { cliente?: PrismaClient } = {}): Promise<readonly NoContaTela[]> {
  exigir(ctx, 'cad.plano_contas', 'consultar');
  return (await listarArvoreContas(deps.cliente ?? prisma, { incluirInativos: true })).map(paraNoTela);
}

/** Os centros de custo inteiros, com os inativos (a tela só os mostra com "Mostrar inativos"). */
export async function consultarArvoreCentrosCusto(ctx: ContextoRequisicao, deps: { cliente?: PrismaClient } = {}): Promise<readonly NoCcTela[]> {
  exigir(ctx, 'cad.centros_custo', 'consultar');
  return (await listarArvoreCentrosCusto(deps.cliente ?? prisma, { incluirInativos: true })).map(paraNoTelaCc);
}

/** Escopo dos filtros retidos na sessão (R18): hash do sessaoUid, nunca o valor cru, que leva o IP. */
export function escopoDaSessao(ctx: Pick<ContextoRequisicao, 'sessaoUid'>): string {
  return createHash('sha256').update(ctx.sessaoUid).digest('base64url').slice(0, 16);
}
