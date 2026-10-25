import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma } from '@/shared/db';
import { criarFila, publicarOutbox, registrarNoOutbox } from '@/shared/filas';
import { iniciarBancoTeste } from './banco';

// Filas com pg-boss e outbox transacional (US-010), sobre PostgreSQL real.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let fila: Awaited<ReturnType<typeof criarFila>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;

const esperar = async (cond: () => boolean | Promise<boolean>, ms = 5000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condição não atingida a tempo');
};

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  fila = await criarFila(banco.urlFila);
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
});

afterAll(async () => {
  try {
    await Promise.allSettled([fila?.parar(), app?.$disconnect(), migrator?.end()]);
  } finally {
    await banco?.parar();
  }
});

describe('fila', () => {
  it('entrega o job ao trabalhador registrado', async () => {
    const recebidos: unknown[] = [];
    await fila.registrarTrabalhador<{ x: number }>('teste.eco', async (dados) => {
      recebidos.push(dados);
    });
    await fila.enviar('teste.eco', { x: 1 });
    await esperar(() => recebidos.length === 1);
    expect(recebidos).toEqual([{ x: 1 }]);
  });

  it('job que falha fica failed e consultável (visível e reprocessável)', async () => {
    await fila.registrarTrabalhador('email.enviar', async () => {
      throw new Error('SMTP fora');
    });
    const id = await fila.enviar('email.enviar', { para: 'x' }, { tentativas: 1 });
    await esperar(async () => (await fila.consultar('email.enviar', id))?.estado === 'failed', 10_000);
    expect(await fila.consultar('email.enviar', id)).toMatchObject({ estado: 'failed' });
  });

  it('sgo_fila não acessa as tabelas da aplicação', async () => {
    const c = new pg.Client({ connectionString: banco.urlFila });
    await c.connect();
    try {
      await expect(c.query('SELECT * FROM outbox_mensagem')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});

describe('outbox', () => {
  it('transação que commita publica; transação desfeita não', async () => {
    const recebidos: unknown[] = [];
    await fila.registrarTrabalhador<{ n: number }>('outbox.publicar', async (dados) => {
      recebidos.push(dados);
    });
    await app.$transaction((tx) => registrarNoOutbox(tx, 'outbox.publicar', { n: 1 }));
    await expect(
      app.$transaction(async (tx) => {
        await registrarNoOutbox(tx, 'outbox.publicar', { n: 2 });
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');

    expect(await publicarOutbox(fila, app)).toBe(1);
    expect(await publicarOutbox(fila, app)).toBe(0);
    const { rows } = await migrator.query('SELECT publicado_em IS NOT NULL AS publicado FROM outbox_mensagem');
    expect(rows).toEqual([{ publicado: true }]);
    await esperar(() => recebidos.length === 1);
    expect(recebidos).toEqual([{ n: 1 }]);
  });

  it('duas publicações ao mesmo tempo não publicam a mesma linha duas vezes', async () => {
    for (let i = 0; i < 20; i++) {
      await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { i }));
    }
    const [a, b] = await Promise.all([publicarOutbox(fila, app, 50), publicarOutbox(fila, app, 50)]);
    expect(a + b).toBe(20);
    const { rows } = await migrator.query('SELECT count(*)::int AS n FROM outbox_mensagem WHERE publicado_em IS NULL');
    expect(rows).toEqual([{ n: 0 }]);
  });
});
