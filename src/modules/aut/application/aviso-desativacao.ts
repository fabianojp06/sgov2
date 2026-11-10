import type { PrismaClient } from '@/generated/prisma/client';
import { obterEstadoSistema } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { prisma } from '@/shared/db';

export type DepsAviso = { cliente: PrismaClient; agora: () => Date };

// Aviso da desativação do sistema na casca (D-P9-4; UC02.01 2.7): os segundos que faltam, calculados
// no servidor (o relógio do navegador não entra na conta), ou null sem contagem. Quem desativou não
// recebe o aviso.
export async function obterAvisoDesativacao(ctx: ContextoRequisicao, deps: Partial<DepsAviso> = {}): Promise<{ segundos: number | null }> {
  const agora = (deps.agora ?? (() => new Date()))();
  const estado = await obterEstadoSistema(deps.cliente ?? prisma, agora);
  if (!estado.ativo || !estado.desativacaoEm || estado.por === ctx.usuarioId) return { segundos: null };
  return { segundos: Math.max(0, Math.ceil((estado.desativacaoEm.getTime() - agora.getTime()) / 1000)) };
}
