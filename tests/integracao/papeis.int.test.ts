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
  await Promise.all([app?.end(), migrator?.end()]);
  await banco?.parar();
});

describe('papéis de banco', () => {
  it('sgo_app não cria tabelas no schema public', async () => {
    await expect(app.query('CREATE TABLE x (id int)')).rejects.toThrow('permission denied for schema public');
  });

  it('sgo_app, sgo_sync e sgo_migrator não têm BYPASSRLS nem superusuário', async () => {
    const { rows } = await app.query(
      "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('sgo_app', 'sgo_sync', 'sgo_migrator') ORDER BY rolname",
    );
    expect(rows).toEqual([
      { rolname: 'sgo_app', rolbypassrls: false, rolsuper: false },
      { rolname: 'sgo_migrator', rolbypassrls: false, rolsuper: false },
      { rolname: 'sgo_sync', rolbypassrls: false, rolsuper: false },
    ]);
  });

  it('o migrator cria uma tabela e sgo_app manipula os dados dela', async () => {
    await migrator.query('CREATE TABLE t_priv (id serial PRIMARY KEY, valor int)');
    await app.query('INSERT INTO t_priv (valor) VALUES (1)');
    const { rows } = await app.query('SELECT valor FROM t_priv');
    expect(rows).toEqual([{ valor: 1 }]);
    await expect(app.query('DROP TABLE t_priv')).rejects.toThrow('must be owner of table t_priv');
  });

  it('a migration de privilégios foi aplicada por migrate deploy', async () => {
    const { rows } = await migrator.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL');
    expect(rows.map((r) => r.migration_name)).toContain('202610260000_nucleo_privilegios');
  });
});
