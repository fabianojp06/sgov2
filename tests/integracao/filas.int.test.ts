import { spawn } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarPrisma } from '@/shared/db';
import { criarFila, publicarOutbox, registrarNoOutbox, type Fila } from '@/shared/filas';
import { MAX_TENTATIVAS_OUTBOX } from '@/shared/filas/outbox';
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


describe('#182: privilégios do sgo_fila e índice do outbox', () => {
  it('sgo_fila não tem privilégio em nada do schema public (tabela, coluna, view, sequence, função) nem cria nele', async () => {
    // has_table_privilege(nome) falhava ao resolver nomes do catálogo: o oid do pg_class evita isso.
    const { rows } = await migrator.query<{ objeto: string }>(
      `SELECT c.relname AS objeto FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (has_table_privilege('sgo_fila', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               OR has_any_column_privilege('sgo_fila', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
       UNION ALL
       SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        -- CASE: sem ele, o planejador pode chamar has_sequence_privilege em relação que não é sequence.
        WHERE n.nspname = 'public' AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('sgo_fila', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END
       UNION ALL
       SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND has_function_privilege('sgo_fila', p.oid, 'EXECUTE')
          -- As funções de extensão (pgvector) são de todos por natureza; o que se confere são as do sistema.
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`,
    );
    expect(rows).toEqual([]);
    const { rows: tabelas } = await migrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    expect(tabelas[0]!.n).toBeGreaterThan(10); // a consulta de cima viu as tabelas de verdade
    const { rows: schema } = await migrator.query<{ cria: boolean }>(`SELECT has_schema_privilege('sgo_fila', 'public', 'CREATE') AS cria`);
    expect(schema[0]!.cria).toBe(false);
  });

  it('a leitura de pendentes do publicarOutbox usa o índice parcial outbox_mensagem_pendentes_idx, sem ordenar à parte', async () => {
    // O catálogo prova a forma do índice (coluna e predicado); o EXPLAIN prova que ele serve à consulta.
    const { rows: indice } = await migrator.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'outbox_mensagem_pendentes_idx'`,
    );
    expect(indice[0]?.indexdef).toMatch(/\(criado_em\) WHERE \(publicado_em IS NULL\)$/);
    // Cliente próprio: a transação com o seqscan desligado não encosta no migrator dos outros testes.
    const c = new pg.Client({ connectionString: banco.urlMigrator });
    await c.connect();
    try {
      await c.query('BEGIN');
      // Com poucas linhas o planejador prefere varrer a tabela ou o bitmap com Sort: sem os dois, o plano
      // mostra se o índice serve à leitura já ordenada por criado_em.
      await c.query('SET LOCAL enable_seqscan = off');
      await c.query('SET LOCAL enable_bitmapscan = off');
      // A mesma consulta do publicarOutbox, com o limite de tentativas como parâmetro, como lá.
      const { rows } = await c.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, tipo, dados FROM outbox_mensagem
          WHERE publicado_em IS NULL AND tentativas < $1 AND NOT (id::text = ANY($2::text[]))
          ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [MAX_TENTATIVAS_OUTBOX, []],
      );
      const plano = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plano).toMatch(/using outbox_mensagem_pendentes_idx on outbox_mensagem\b/);
      expect(plano).not.toMatch(/\bSort\b/);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  });
});

describe('C4: dado sensível', () => {
  it('apagarJob remove o job (e seus dados) depois do envio', async () => {
    // Os trabalhadores de 'teste.eco' já registrados consomem o job.
    const id = await fila.enviar('teste.eco', { s: 'dado sensível' });
    await esperar(async () => (await fila.consultar('teste.eco', id))?.estado === 'completed', 10_000);
    await fila.apagarJob('teste.eco', id);
    expect(await fila.consultar('teste.eco', id)).toBeNull();
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

describe('revisão 12.12, rodada 2', () => {
  it('SKIP LOCKED: o segundo publicador não espera a linha travada pelo primeiro', async () => {
    await migrator.query('DELETE FROM outbox_mensagem');
    await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { k: 1 }));
    await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { k: 2 }));
    let liberar: () => void = () => {};
    const travada = new Promise<void>((r) => (liberar = r));
    const lenta: Fila = { enviar: async (_n, _d, o) => (await travada, o!.chaveUnica!) };
    const primeiro = publicarOutbox(lenta, app, 1);
    await new Promise((r) => setTimeout(r, 300));
    const inicio = Date.now();
    expect(await publicarOutbox(fila, app, 1)).toBe(1);
    expect(Date.now() - inicio).toBeLessThan(2000);
    liberar();
    expect(await primeiro).toBe(1);
  });

  it('erro de infraestrutura no envio sobe e não gasta tentativa da mensagem', async () => {
    await migrator.query('DELETE FROM outbox_mensagem');
    await app.$transaction((tx) => registrarNoOutbox(tx, 'teste.eco', { k: 3 }));
    const quebrada: Fila = {
      enviar: async () => {
        throw new Error('conexão recusada');
      },
    };
    await expect(publicarOutbox(quebrada, app)).rejects.toThrow('conexão recusada');
    const { rows } = await migrator.query('SELECT tentativas FROM outbox_mensagem');
    expect(rows).toEqual([{ tentativas: 0 }]);
  });

  const rodarWorker = (env: Record<string, string>) =>
    spawn(process.execPath, ['--import', 'tsx', 'worker/index.ts'], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test', ...env },
    });

  it('worker sem FILA_DATABASE_URL sai com código 1', async () => {
    const p = rodarWorker({ DATABASE_URL: banco.urlApp });
    const codigo = await new Promise<number | null>((r) => p.on('exit', r));
    expect(codigo).toBe(1);
  });

  it('worker encerra limpo no SIGTERM (código 0)', async () => {
    const p = rodarWorker({ DATABASE_URL: banco.urlApp, FILA_DATABASE_URL: banco.urlFila });
    let saida = '';
    p.stdout.on('data', (d) => (saida += String(d)));
    await esperar(() => saida.includes('worker pronto'), 30_000);
    const fim = new Promise<number | null>((r) => p.on('exit', r));
    p.kill('SIGTERM');
    expect(await fim).toBe(0);
    expect(saida).toContain('SIGTERM recebido');
  }, 60_000);
});
