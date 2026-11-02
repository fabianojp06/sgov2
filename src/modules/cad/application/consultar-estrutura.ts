import 'server-only';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import { paraNoTela, type NoContaTela } from '../domain/arvore-tela';
import { listarArvoreContas } from '../infrastructure/estrutura-financeira';

// Consulta do plano de contas em árvore, só leitura (US-044; plano do P4, Task 7b; C27, RN_PLA_001).

/** A árvore inteira, com as inativas (a tela só as mostra com "Mostrar inativas"). */
export async function consultarArvoreContas(ctx: ContextoRequisicao, deps: { cliente?: PrismaClient } = {}): Promise<readonly NoContaTela[]> {
  exigir(ctx, 'cad.plano_contas', 'consultar');
  return (await listarArvoreContas(deps.cliente ?? prisma, { incluirInativos: true })).map(paraNoTela);
}

/** Escopo dos filtros retidos na sessão (R18): hash do sessaoUid, nunca o valor cru, que leva o IP. */
export function escopoDaSessao(ctx: Pick<ContextoRequisicao, 'sessaoUid'>): string {
  return createHash('sha256').update(ctx.sessaoUid).digest('base64url').slice(0, 16);
}
