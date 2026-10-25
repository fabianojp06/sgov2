import type { PrismaClient } from '@/generated/prisma/client';
import type { TxCliente } from './prisma';

// Seeds idempotentes (upsert): rodar duas vezes não duplica nem falha.
export type Seed = { nome: string; executar(tx: TxCliente): Promise<void> };

export async function executarSeeds(cliente: PrismaClient, seeds: readonly Seed[]): Promise<void> {
  for (const seed of seeds) {
    try {
      await cliente.$transaction((tx) => seed.executar(tx));
    } catch (erro) {
      throw new Error(`Falha na seed "${seed.nome}"`, { cause: erro });
    }
  }
}
