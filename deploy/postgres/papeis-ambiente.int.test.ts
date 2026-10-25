import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Prova o 01-papeis-ambiente.sql (hml e prod) num Postgres limpo, sem o 01-papeis.sql de dev.
// Mesmas travas de tests/integracao/banco.ts (D12): 512 MB, oom_score_adj 500, porta só em
// 127.0.0.1 e sem o Ryuk. Lá a classe não é exportada, por isso a cópia.
const MEMORIA = 512 * 1024 * 1024;

class PostgresLocal extends PostgreSqlContainer {
  override async start(): Promise<StartedPostgreSqlContainer> {
    const ligacoes = (this.hostConfig.PortBindings ?? {}) as Record<string, { HostIp?: string }[]>;
    for (const lista of Object.values(ligacoes)) {
      for (const ligacao of lista) ligacao.HostIp = '127.0.0.1';
    }
    this.hostConfig.Memory = MEMORIA;
    this.hostConfig.MemorySwap = MEMORIA;
    this.hostConfig.OomScoreAdj = 500;
    return super.start();
  }
}

const SCRIPT = '/papeis/01-papeis-ambiente.sql';
const SENHAS = {
  SGO_SENHA_MIGRATOR: 'senha-de-teste-migrator',
  SGO_SENHA_APP: 'senha-de-teste-app-1234',
  SGO_SENHA_SYNC: 'senha-de-teste-sync-1234',
  SGO_SENHA_FILA: 'senha-de-teste-fila-1234',
  SGO_SENHA_LEITURA: 'senha-de-teste-leitura-12',
};
const USUARIO_SENHA: Record<string, string> = {
  sgo_migrator: SENHAS.SGO_SENHA_MIGRATOR,
  sgo_app: SENHAS.SGO_SENHA_APP,
  sgo_sync: SENHAS.SGO_SENHA_SYNC,
  sgo_fila: SENHAS.SGO_SENHA_FILA,
  sgo_leitura: SENHAS.SGO_SENHA_LEITURA,
  intruso: 'senha-do-intruso',
};

let container: StartedPostgreSqlContainer;
let host: string;

async function aplicar(env: Record<string, string> = SENHAS) {
  return container.exec(['psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-f', SCRIPT], { env });
}

function url(usuario: string, banco = 'sgo'): string {
  return `postgresql://${usuario}:${encodeURIComponent(USUARIO_SENHA[usuario] ?? '')}@${host}/${banco}`;
}

async function comoPapel<T>(usuario: string, fn: (c: pg.Client) => Promise<T>, banco = 'sgo'): Promise<T> {
  const cliente = new pg.Client({ connectionString: url(usuario, banco) });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

async function comoPostgres<T>(fn: (c: pg.Client) => Promise<T>, banco = 'sgo'): Promise<T> {
  const u = new URL(container.getConnectionUri());
  u.pathname = `/${banco}`;
  const cliente = new pg.Client({ connectionString: u.toString() });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

async function papeis(): Promise<unknown[]> {
  const { rows } = await comoPostgres(
    (c) =>
      c.query(
        `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication,
                rolbypassrls, rolconnlimit, rolvaliduntil, rolconfig
           FROM pg_roles WHERE rolname LIKE 'sgo\\_%' ORDER BY rolname`,
      ),
    'postgres',
  );
  return rows;
}

describe('01-papeis-ambiente.sql (hml e prod)', () => {
  beforeAll(async () => {
    container = await new PostgresLocal('pgvector/pgvector:pg16')
      .withUsername('postgres')
      .withDatabase('postgres')
      // Log de tudo, para provar que o script não deixa senha no log do servidor.
      .withCommand(['postgres', '-c', 'log_statement=all', '-c', 'log_min_duration_statement=0'])
      .withCopyFilesToContainer([{ source: join(process.cwd(), 'deploy/postgres/01-papeis-ambiente.sql'), target: SCRIPT }])
      .start();
    host = `${container.getHost()}:${container.getPort()}`;
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('recusa rodar sem todas as senhas e não cria nada', async () => {
    const semLeitura: Record<string, string> = { ...SENHAS };
    delete semLeitura.SGO_SENHA_LEITURA;
    const r = await aplicar(semLeitura);
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('SGO_SENHA_LEITURA');
    expect(await papeis()).toEqual([]);
  });

  it('recusa senha curta e não a mostra na saída', async () => {
    const r = await aplicar({ ...SENHAS, SGO_SENHA_APP: 'curta' });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('SGO_SENHA_APP');
    expect(r.output).not.toContain('curta');
    expect(await papeis()).toEqual([]);
  });

  it('recusa senhas repetidas', async () => {
    const r = await aplicar({ ...SENHAS, SGO_SENHA_SYNC: SENHAS.SGO_SENHA_APP });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('diferentes');
    expect(await papeis()).toEqual([]);
  });

  it('cria os papéis e o banco do zero', async () => {
    const r = await aplicar();
    expect(r.output).toBe('');
    expect(r.exitCode).toBe(0);
    for (const s of Object.values(SENHAS)) expect(r.output).not.toContain(s);
  });

  it('nenhum papel do SGO é superusuário ou tem BYPASSRLS', async () => {
    const linhas = (await papeis()) as { rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }[];
    expect(linhas.map((l) => l.rolname)).toEqual(['sgo_admin', 'sgo_app', 'sgo_fila', 'sgo_leitura', 'sgo_migrator', 'sgo_sync']);
    for (const l of linhas) {
      expect(l.rolsuper, l.rolname).toBe(false);
      expect(l.rolbypassrls, l.rolname).toBe(false);
    }
    expect(linhas.find((l) => l.rolname === 'sgo_admin')?.rolcanlogin).toBe(false);
  });

  it('fixa o search_path e deixa a sessão do sgo_leitura só de leitura', async () => {
    const config = Object.fromEntries(
      ((await papeis()) as { rolname: string; rolconfig: string[] | null }[]).map((l) => [l.rolname, l.rolconfig]),
    );
    expect(config).toEqual({
      sgo_admin: null,
      sgo_app: ['search_path=public'],
      sgo_fila: ['search_path=pgboss'],
      sgo_leitura: ['search_path=public', 'default_transaction_read_only=on'],
      sgo_migrator: ['search_path=public'],
      sgo_sync: ['search_path=public'],
    });
  });

  it('o pgvector já vem instalado, e a migration que o declara não falha', async () => {
    await comoPapel('sgo_migrator', (c) => c.query('CREATE EXTENSION IF NOT EXISTS vector'));
    const { rows } = await comoPostgres((c) => c.query(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'`));
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('o sgo_admin é dono do banco e o sgo_migrator, só do schema public', async () => {
    const { rows } = await comoPostgres((c) =>
      c.query(`SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'sgo') AS banco,
                      (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') AS publico,
                      (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'pgboss') AS filas`),
    );
    expect(rows[0]).toEqual({ banco: 'sgo_admin', publico: 'sgo_migrator', filas: 'sgo_fila' });
  });

  it('as migrations reais rodam como sgo_migrator', () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, MIGRATE_DATABASE_URL: url('sgo_migrator'), SHADOW_DATABASE_URL: '' },
      stdio: 'pipe',
      timeout: 90_000,
    });
  }, 120_000);

  it('o sgo_migrator cria tabela no public, mas não altera o banco nem cria schema', async () => {
    await comoPapel('sgo_migrator', async (c) => {
      await c.query('CREATE TABLE prova_leitura (id int)');
      await c.query('INSERT INTO prova_leitura VALUES (1)');
      await c.query(`CREATE FUNCTION prova_funcao() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
      await expect(c.query(`ALTER DATABASE sgo SET work_mem = '8MB'`)).rejects.toThrow(/must be owner|permission denied/);
      await expect(c.query('CREATE SCHEMA outro')).rejects.toThrow(/permission denied/);
    });
  });

  it.each(['sgo_app', 'sgo_sync'])('%s conecta, usa as tabelas e não cria objetos', async (papel) => {
    await comoPapel(papel, async (c) => {
      await c.query('SELECT count(*) FROM historico_operacao');
      await expect(c.query('CREATE TABLE t (id int)')).rejects.toThrow(/permission denied/);
      await expect(c.query('CREATE TEMP TABLE t (id int)')).rejects.toThrow(/permission denied/);
    });
  });

  it('o sgo_leitura lê e não escreve', async () => {
    await comoPapel('sgo_leitura', async (c) => {
      const { rows } = await c.query('SELECT id FROM prova_leitura');
      expect(rows).toEqual([{ id: 1 }]);
      await c.query('SELECT count(*) FROM historico_operacao');
      await expect(c.query('INSERT INTO prova_leitura VALUES (2)')).rejects.toThrow(/read-only transaction/);
      const somenteLeitura = await c.query('SHOW default_transaction_read_only');
      expect(somenteLeitura.rows).toEqual([{ default_transaction_read_only: 'on' }]);
      // A sessão só de leitura é reforço (o próprio papel desliga); quem garante é o privilégio.
      await c.query('SET default_transaction_read_only = off');
      await expect(c.query('INSERT INTO prova_leitura VALUES (2)')).rejects.toThrow(/permission denied for table/);
    });
  });

  it('o sgo_fila cria as tabelas das filas só no pgboss', async () => {
    await comoPapel('sgo_fila', async (c) => {
      await c.query('CREATE TABLE pgboss.prova (id int)');
      await expect(c.query('CREATE TABLE public.prova_fila (id int)')).rejects.toThrow(/permission denied/);
    });
  });

  it('um papel sem grant não conecta no sgo, no postgres nem no template1', async () => {
    await comoPostgres((c) => c.query(`CREATE ROLE intruso LOGIN PASSWORD '${USUARIO_SENHA.intruso}'`), 'postgres');
    await expect(comoPapel('intruso', (c) => c.query('SELECT 1'))).rejects.toThrow(/permission denied for database/);
    await expect(comoPapel('intruso', (c) => c.query('SELECT 1'), 'postgres')).rejects.toThrow(/permission denied for database/);
    await expect(comoPapel('intruso', (c) => c.query('SELECT 1'), 'template1')).rejects.toThrow(/permission denied for database/);
    await expect(comoPapel('sgo_app', (c) => c.query('SELECT 1'), 'postgres')).rejects.toThrow(/permission denied for database/);
  });

  it('função criada pelo sgo_migrator não é executável por quem não recebeu grant', async () => {
    await comoPostgres((c) => c.query('GRANT CONNECT ON DATABASE sgo TO intruso; GRANT USAGE ON SCHEMA public TO intruso'));
    await expect(comoPapel('intruso', (c) => c.query('SELECT prova_funcao()'))).rejects.toThrow(/permission denied for function/);
    await expect(comoPapel('sgo_app', (c) => c.query('SELECT prova_funcao()'))).rejects.toThrow(/permission denied for function/);
  });

  it('o pg_dump como postgres pelo socket local passa com RLS (caminho do dump diário)', async () => {
    await comoPapel('sgo_migrator', async (c) => {
      await c.query('CREATE TABLE prova_rls (unidade int)');
      await c.query('ALTER TABLE prova_rls ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE prova_rls FORCE ROW LEVEL SECURITY');
      await c.query(`CREATE POLICY por_unidade ON prova_rls USING (unidade = 1)`);
    });
    const r = await container.exec(['pg_dump', '-U', 'postgres', '-d', 'sgo', '-f', '/tmp/sgo.sql']);
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('o sgo_leitura lê tabelas criadas depois do script (default privileges)', async () => {
    await comoPapel('sgo_leitura', (c) => c.query('SELECT count(*) FROM prova_rls'));
  });

  it('rodar de novo não dá erro nem muda os papéis, e avisa quem manteve a senha', async () => {
    const antes = await papeis();
    const r = await aplicar();
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('mantiveram a senha: sgo_app, sgo_fila, sgo_leitura, sgo_migrator, sgo_sync');
    expect(await papeis()).toEqual(antes);
  });

  it('rodar de novo com outra senha não troca a de quem já existe', async () => {
    const r = await aplicar({ ...SENHAS, SGO_SENHA_APP: 'outra-senha-do-app-123' });
    expect(r.exitCode).toBe(0);
    await comoPapel('sgo_app', (c) => c.query('SELECT 1'));
  });

  it('recusa, sem mudar nada, papel do SGO com membership ou configuração por banco', async () => {
    const antes = await papeis();
    await comoPostgres((c) => c.query('GRANT sgo_migrator TO sgo_app; ALTER ROLE sgo_sync BYPASSRLS'), 'postgres');
    let r = await aplicar();
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('sgo_app é membro de sgo_migrator');
    expect(r.output).toContain('nada foi alterado');
    const sync = ((await papeis()) as { rolname: string; rolbypassrls: boolean }[]).find((l) => l.rolname === 'sgo_sync');
    expect(sync?.rolbypassrls).toBe(true);
    await comoPostgres((c) => c.query('REVOKE sgo_migrator FROM sgo_app; ALTER ROLE sgo_sync NOBYPASSRLS'), 'postgres');

    await comoPostgres((c) => c.query('ALTER ROLE sgo_app IN DATABASE sgo SET search_path = outro, public'), 'postgres');
    r = await aplicar();
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain('sgo_app tem configuração no banco sgo');
    await comoPostgres((c) => c.query('ALTER ROLE sgo_app IN DATABASE sgo RESET ALL'), 'postgres');
    expect(await papeis()).toEqual(antes);
  });

  it('desfaz atributos, configurações e privilégios dados a mais', async () => {
    const antes = await papeis();
    await comoPostgres(
      (c) =>
        c.query(`ALTER ROLE sgo_sync BYPASSRLS CONNECTION LIMIT 1 VALID UNTIL '2030-01-01';
                 ALTER ROLE sgo_app SET work_mem = '1MB'`),
      'postgres',
    );
    await comoPostgres((c) =>
      c.query(`GRANT CREATE ON DATABASE sgo TO PUBLIC; GRANT TEMPORARY ON DATABASE sgo TO sgo_app;
               GRANT CREATE ON SCHEMA public TO sgo_app; GRANT USAGE ON SCHEMA pgboss TO sgo_app`),
    );
    const r = await aplicar();
    expect(r.exitCode).toBe(0);
    expect(await papeis()).toEqual(antes);
    await comoPapel('sgo_app', async (c) => {
      await expect(c.query('CREATE TABLE t (id int)')).rejects.toThrow(/permission denied for schema public/);
      await expect(c.query('CREATE TEMP TABLE t (id int)')).rejects.toThrow(/permission denied to create temporary tables in database/);
      await expect(c.query('CREATE SCHEMA outro')).rejects.toThrow(/permission denied for database sgo/);
      await expect(c.query('SELECT 1 FROM pgboss.prova')).rejects.toThrow(/permission denied for schema pgboss/);
    });
  });

  it('nenhuma senha vai para o log do servidor', () => {
    const logs = spawnSync('docker', ['logs', container.getId()], { encoding: 'utf8' });
    const texto = `${logs.stdout}${logs.stderr}`;
    // O log está ligado de verdade: os comandos do próprio teste aparecem nele.
    expect(texto).toContain('CREATE ROLE intruso');
    for (const s of [...Object.values(SENHAS), 'outra-senha-do-app-123']) expect(texto).not.toContain(s);
  });
});
