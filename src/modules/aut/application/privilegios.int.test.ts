import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Privilégios de sessao_usuario (migration 202610260400_aut_sessao).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: pg.Client;
let app: pg.Client;
let sync: pg.Client;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  app = new pg.Client({ connectionString: banco.urlApp });
  sync = new pg.Client({ connectionString: banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync') });
  await Promise.all([migrator.connect(), app.connect(), sync.connect()]);
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Ana', 'ana@exemplo.org', 'ana', 'ana', 'x') RETURNING id`);
  await migrator.query(
    `INSERT INTO sessao_usuario (usuario_id, token_hash, sessao_uid, criada_em, ultimo_acesso_em, expira_em, acesso_versao, troca_senha_pendente)
     VALUES ($1, 'h1', 'u1', now(), now(), now() + interval '1 hour', 0, false)`,
    [(rows[0] as { id: string }).id],
  );
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.end(), app?.end(), sync?.end()]);
  } finally {
    await banco?.parar();
  }
});

const negado = expect.objectContaining({ code: '42501' });

describe('privilégios de sessao_usuario', () => {
  it('sgo_sync não lê sessões', () => expect(sync.query('SELECT * FROM sessao_usuario')).rejects.toEqual(negado));

  it('sgo_app só atualiza o último acesso e a troca pendente', async () => {
    await expect(app.query('UPDATE sessao_usuario SET ultimo_acesso_em = now(), troca_senha_pendente = true')).resolves.toBeDefined();
    await expect(app.query(`UPDATE sessao_usuario SET token_hash = 'outro'`)).rejects.toEqual(negado);
    await expect(app.query(`UPDATE sessao_usuario SET expira_em = now() + interval '10 years'`)).rejects.toEqual(negado);
    await expect(app.query('UPDATE sessao_usuario SET acesso_versao = 9')).rejects.toEqual(negado);
  });

  it('uma sessão por usuário também no banco (RN0519)', async () => {
    await expect(
      migrator.query(
        `INSERT INTO sessao_usuario (usuario_id, token_hash, sessao_uid, criada_em, ultimo_acesso_em, expira_em, acesso_versao, troca_senha_pendente)
         SELECT usuario_id, 'h2', 'u2', now(), now(), now(), 0, false FROM sessao_usuario LIMIT 1`,
      ),
    ).rejects.toEqual(expect.objectContaining({ code: '23505' }));
  });
});
