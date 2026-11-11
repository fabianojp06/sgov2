import type { PrismaClient } from '@/generated/prisma/client';

// Sinal de vida do worker (US-017): gravado no banco a cada ciclo do outbox que dá certo, com a hora do
// banco. Sem server-only: roda no worker.
export async function registrarSinalVida(cliente: PrismaClient): Promise<void> {
  await cliente.$executeRaw`INSERT INTO "sinal_vida" ("componente") VALUES ('worker')
    ON CONFLICT ("componente") DO UPDATE SET "atualizado_em" = clock_timestamp()`;
}
