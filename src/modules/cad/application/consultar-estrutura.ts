import 'server-only';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { exigir, type ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';
import type { NoConta } from '../domain/estrutura';
import { listarArvoreContas } from '../infrastructure/estrutura-financeira';
import { SITUACAO_INATIVA, type NoContaTela } from '../ui/arvore-contas-logica';

// Consulta do plano de contas em árvore, só leitura (US-044; plano do P4, Task 7b; C27, RN_PLA_001).

function paraNo(c: NoConta): NoContaTela {
  return {
    id: c.classificacao,
    linha: {
      classificacao: c.classificacao,
      reduzido: c.codigoReduzido,
      descricao: c.descricao,
      nivel: String(c.nivel),
      tipo: c.tipo === 'SINTETICA' ? 'Sintética' : 'Analítica',
      situacao: c.ativa ? 'Ativa' : SITUACAO_INATIVA,
    },
    ...(c.filhos.length > 0 ? { filhos: c.filhos.map(paraNo) } : {}),
  };
}

/** A árvore inteira, com as inativas (a tela só as mostra com "Mostrar inativas"). */
export async function consultarArvoreContas(ctx: ContextoRequisicao, deps: { cliente?: PrismaClient } = {}): Promise<readonly NoContaTela[]> {
  exigir(ctx, 'cad.plano_contas', 'consultar');
  return (await listarArvoreContas(deps.cliente ?? prisma, { incluirInativos: true })).map(paraNo);
}

/** Escopo dos filtros retidos na sessão (R18): hash do sessaoUid, nunca o valor cru, que leva o IP. */
export function escopoDaSessao(ctx: Pick<ContextoRequisicao, 'sessaoUid'>): string {
  return createHash('sha256').update(ctx.sessaoUid).digest('base64url').slice(0, 16);
}
