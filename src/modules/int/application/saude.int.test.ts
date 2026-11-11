import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { registrarSinalVida } from '../infrastructure/sinal-vida';
import { verificarSaude } from './saude';

// Saúde do sistema (US-017) num Postgres real (Testcontainers, D12): o banco e o sinal de vida do worker,
// gravado e lido pelo sgo_app com a hora do banco.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
}, 120_000);

afterAll(async () => {
  await app?.$disconnect();
  await migrator?.end();
  await banco?.parar();
});

describe('verificarSaude', () => {
  it('sem sinal do worker: banco ok, worker parado, status falha', async () => {
    expect(await verificarSaude({ cliente: app })).toEqual({ status: 'falha', banco: 'ok', worker: 'parado' });
  });

  it('com o sinal recente (gravado pelo sgo_app, duas vezes): tudo ok', async () => {
    await registrarSinalVida(app);
    await registrarSinalVida(app);
    expect(await verificarSaude({ cliente: app })).toEqual({ status: 'ok', banco: 'ok', worker: 'ok' });
    expect((await migrator.query('SELECT count(*)::int AS n FROM sinal_vida')).rows[0].n).toBe(1);
  });

  it('sinal com mais de 60 s: worker parado', async () => {
    await migrator.query(`UPDATE sinal_vida SET atualizado_em = clock_timestamp() - interval '61 seconds'`);
    expect(await verificarSaude({ cliente: app })).toEqual({ status: 'falha', banco: 'ok', worker: 'parado' });
  });

  it('banco fora: falha, worker desconhecido, sem lançar', async () => {
    const fora = criarPrisma(banco.urlApp.replace(/:\d+\//, ':1/'));
    try {
      expect(await verificarSaude({ cliente: fora, limiteMs: 3000 })).toEqual({ status: 'falha', banco: 'falha', worker: 'desconhecido' });
    } finally {
      await fora.$disconnect();
    }
  });

  it('o sgo_app não apaga o sinal nem grava outro componente', async () => {
    await expect(app.$executeRaw`DELETE FROM "sinal_vida"`).rejects.toThrow();
    await expect(app.$executeRaw`INSERT INTO "sinal_vida" ("componente") VALUES ('app')`).rejects.toThrow();
  });
});
