import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma, executarSeeds, type Seed } from '@/shared/db';
import { iniciarBancoTeste } from './banco';

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let cliente: ReturnType<typeof criarPrisma>;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  cliente = criarPrisma(banco.urlMigrator);
  await cliente.$executeRawUnsafe('CREATE TABLE t_seed (codigo text PRIMARY KEY, nome text NOT NULL)');
});

afterAll(async () => {
  // Sem o Ryuk, parar() precisa rodar mesmo se desconectar falhar (D12).
  try {
    await cliente?.$disconnect();
  } finally {
    await banco?.parar();
  }
});

const seedTeste: Seed = {
  nome: 'teste',
  executar: async (tx) => {
    await tx.$executeRaw`INSERT INTO t_seed (codigo, nome) VALUES ('A', 'Alfa')
      ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome`;
  },
};

describe('executarSeeds', () => {
  it('é idempotente: rodar duas vezes deixa uma linha e não lança', async () => {
    await executarSeeds(cliente, [seedTeste]);
    await executarSeeds(cliente, [seedTeste]);
    const linhas = await cliente.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM t_seed`;
    expect(linhas[0]?.total).toBe(1n);
  });

  it('desfaz a seed que falha e informa o nome dela', async () => {
    const quebrada: Seed = {
      nome: 'quebrada',
      executar: async (tx) => {
        await tx.$executeRaw`INSERT INTO t_seed (codigo, nome) VALUES ('B', 'Beta')`;
        throw new Error('falhou no meio');
      },
    };
    await expect(executarSeeds(cliente, [quebrada])).rejects.toThrow('Falha na seed "quebrada"');
    const linhas = await cliente.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM t_seed WHERE codigo = 'B'`;
    expect(linhas[0]?.total).toBe(0n);
  });
});
