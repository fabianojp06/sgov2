import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('job com falha pode ser reprocessado e concluir', async () => {
    let falhar = true;
    const recebidos: unknown[] = [];
    await fila.registrarTrabalhador<{ n: number }>('outbox.publicar', async (dados) => {
      if (falhar) throw new Error('falha temporária');
      recebidos.push(dados);
    });
    const id = await fila.enviar('outbox.publicar', { n: 99 }, { tentativas: 1 });
    await esperar(async () => (await fila.consultar('outbox.publicar', id))?.estado === 'failed', 10_000);
    falhar = false;
    await fila.reprocessar('outbox.publicar', id);
    await esperar(async () => (await fila.consultar('outbox.publicar', id))?.estado === 'completed', 10_000);
    expect(recebidos).toEqual([{ n: 99 }]);
  });

  it('sgo_fila não acessa as tabelas da aplicação', async () => {
    const c = new pg.Client({ connectionString: banco.urlFila });
    await c.connect();
    try {
      await expect(c.query('SELECT * FROM public.outbox_mensagem')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});

describe('outbox', () => {
  it('transação que commita publica; transação desfeita não', async () => {
    await app.$transaction((tx) => registrarNoOutbox(tx, 'email.enviar', { n: 1 }));
    await expect(
      app.$transaction(async (tx) => {
        await registrarNoOutbox(tx, 'email.enviar', { n: 2 });
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');

    expect(await publicarOutbox(fila, app)).toBe(1);
    expect(await publicarOutbox(fila, app)).toBe(0);
    const { rows } = await migrator.query('SELECT id, publicado_em IS NOT NULL AS publicado, dados FROM outbox_mensagem');
    expect(rows).toEqual([{ id: expect.any(String), publicado: true, dados: {} }]);
    // O job tem os dados; a linha do outbox não guarda mais (C4: dado sensível).
    const job = await fila.consultar('email.enviar', (rows[0] as { id: string }).id);
    expect(job).not.toBeNull();
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

describe('revisão 12.12: idempotência e falhas no outbox', () => {
  it('enviar 2 vezes com a mesma chaveUnica cria um job só', async () => {
    const chave = '6a7c1d2e-3f40-4b51-8c62-7d83e94fa0b2';
    const a = await fila.enviar('teste.eco', { y: 1 }, { chaveUnica: chave });
    const b = await fila.enviar('teste.eco', { y: 2 }, { chaveUnica: chave });
    expect([a, b]).toEqual([chave, chave]);
    expect(await fila.consultar('teste.eco', chave)).not.toBeNull();
  });

  it('mensagem que falha não trava as outras: registra tentativa e erro e segue', async () => {
    await migrator.query('DELETE FROM outbox_mensagem');
    await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { ok: 1 }));
    // Tipo inválido gravado direto no banco: o envio falha sempre.
    await migrator.query(
      "INSERT INTO outbox_mensagem (tipo, dados, criado_em) VALUES ('fila.inexistente', '{}', now() - interval '1 hour')",
    );
    await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { ok: 2 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await publicarOutbox(fila, app)).toBe(2);
    const { rows } = await migrator.query(
      "SELECT tentativas, ultimo_erro IS NOT NULL AS com_erro, publicado_em IS NULL AS pendente FROM outbox_mensagem WHERE tipo = 'fila.inexistente'",
    );
    expect(rows).toEqual([{ tentativas: 1, com_erro: true, pendente: true }]);
    expect(JSON.stringify(log.mock.calls)).toContain('[OUTBOX_MENSAGEM_FALHOU]');
    log.mockRestore();
  });

  it('mensagem que esgota as tentativas para de ser reprocessada', async () => {
    await migrator.query("UPDATE outbox_mensagem SET tentativas = 10 WHERE tipo = 'fila.inexistente'");
    expect(await publicarOutbox(fila, app)).toBe(0);
    const { rows } = await migrator.query("SELECT tentativas FROM outbox_mensagem WHERE tipo = 'fila.inexistente'");
    expect(rows).toEqual([{ tentativas: 10 }]);
  });

  it('reenvio depois de queda entre o envio e o commit não duplica o job', async () => {
    await migrator.query('DELETE FROM outbox_mensagem');
    await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { r: 1 }));
    const { rows } = await migrator.query('SELECT id FROM outbox_mensagem');
    const id = (rows[0] as { id: string }).id;
    // Simula a queda: o job saiu, mas a marcação não foi gravada.
    await fila.enviar('teste.eco', { r: 1 }, { chaveUnica: id });
    expect(await publicarOutbox(fila, app)).toBe(1);
    const filaPg = new pg.Client({ connectionString: banco.urlFila });
    await filaPg.connect();
    try {
      const jobs = await filaPg.query('SELECT count(*)::int AS n FROM pgboss.job WHERE id = $1', [id]);
      expect(jobs.rows).toEqual([{ n: 1 }]);
    } finally {
      await filaPg.end();
    }
  });
});
