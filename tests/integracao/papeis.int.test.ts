import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from './banco';

// Papéis de banco (spec §11.5, US-004): a aplicação nunca tem mais poder do que precisa.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: pg.Client;
let migrator: pg.Client;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = new pg.Client({ connectionString: banco.urlApp });
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await Promise.all([app.connect(), migrator.connect()]);
});

afterAll(async () => {
  // Sem o Ryuk, parar() precisa rodar mesmo se fechar as conexões falhar (D12).
  try {
    await Promise.allSettled([app?.end(), migrator?.end()]);
  } finally {
    await banco?.parar();
  }
});

describe('papéis de banco', () => {
  it('sgo_app não cria tabelas no schema public', async () => {
    await expect(app.query('CREATE TABLE x (id int)')).rejects.toThrow('permission denied for schema public');
  });

  it('sgo_app e sgo_sync não têm CREATE no schema public (nem por grant futuro a PUBLIC)', async () => {
    const { rows } = await migrator.query(
      "SELECT has_schema_privilege('sgo_app', 'public', 'CREATE') AS app, has_schema_privilege('sgo_sync', 'public', 'CREATE') AS sync",
    );
    expect(rows).toEqual([{ app: false, sync: false }]);
  });

  it('sgo_app, sgo_sync e sgo_migrator não têm BYPASSRLS, superusuário, CREATEDB nem CREATEROLE', async () => {
    const { rows } = await app.query(
      "SELECT rolname, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname IN ('sgo_app', 'sgo_sync', 'sgo_migrator') ORDER BY rolname",
    );
    const sem = { rolbypassrls: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false };
    expect(rows).toEqual([
      { rolname: 'sgo_app', ...sem },
      { rolname: 'sgo_migrator', ...sem },
      { rolname: 'sgo_sync', ...sem },
    ]);
  });

  it('o migrator cria uma tabela e sgo_app manipula os dados dela', async () => {
    await migrator.query('CREATE TABLE t_priv (id serial PRIMARY KEY, valor int)');
    await app.query('INSERT INTO t_priv (valor) VALUES (1)');
    const { rows } = await app.query('SELECT valor FROM t_priv');
    expect(rows).toEqual([{ valor: 1 }]);
    await expect(app.query('DROP TABLE t_priv')).rejects.toThrow('must be owner of table t_priv');
  });

  it('o contêiner de teste respeita D12: 512 MB sem swap extra, oom_score_adj 500, porta só em 127.0.0.1', () => {
    const config = JSON.parse(
      execFileSync('docker', ['inspect', '--format', '{{json .HostConfig}}', banco.idContainer], { encoding: 'utf8' }),
    ) as { Memory: number; MemorySwap: number; OomScoreAdj: number; PortBindings: Record<string, { HostIp: string }[]> };
    expect(config.Memory).toBe(512 * 1024 * 1024);
    expect(config.MemorySwap).toBe(config.Memory);
    expect(config.OomScoreAdj).toBe(500);
    const ips = Object.values(config.PortBindings).flat().map((l) => l.HostIp);
    expect(ips.length).toBeGreaterThan(0);
    expect(ips.every((ip) => ip === '127.0.0.1')).toBe(true);
  });

  it('a migration de privilégios foi aplicada por migrate deploy', async () => {
    const { rows } = await migrator.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL');
    expect(rows.map((r) => r.migration_name)).toContain('202610260000_nucleo_privilegios');
  });
});
