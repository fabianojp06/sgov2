import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Privilégios das tabelas do adm (migration 202610260300_adm_acesso).
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
  await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Ana', 'ana@exemplo.org', 'ana', 'ana', 'x')`);
  await migrator.query('INSERT INTO configuracao_acesso (id) VALUES (1)');
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.end(), app?.end(), sync?.end()]);
  } finally {
    await banco?.parar();
  }
});

const negado = expect.objectContaining({ code: '42501' });

describe('privilégios do adm', () => {
  it('sgo_app altera o nome, mas não o login (RN0066)', async () => {
    await expect(app.query(`UPDATE usuario SET nome = 'Ana Maria'`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE usuario SET login = 'outra'`)).rejects.toEqual(negado);
    await expect(app.query(`UPDATE usuario SET login_normalizado = 'outra'`)).rejects.toEqual(negado);
  });

  it('sgo_app não apaga usuário nem cria ou apaga a configuração', async () => {
    await expect(app.query('DELETE FROM usuario')).rejects.toEqual(negado);
    await expect(app.query('DELETE FROM configuracao_acesso')).rejects.toEqual(negado);
    await expect(app.query('INSERT INTO configuracao_acesso (id) VALUES (1)')).rejects.toEqual(negado);
    await expect(app.query('UPDATE configuracao_acesso SET manutencao = true')).resolves.toBeDefined();
  });

  it('sgo_app só ativa e desativa módulo e funcionalidade, e não cria nenhum (C14, REQ0055)', async () => {
    await migrator.query(`INSERT INTO modulo (codigo, nome, ordem) VALUES ('X', 'X', 9)`);
    await migrator.query(`INSERT INTO funcionalidade (codigo, modulo_codigo, grupo, nome, rota, ordem, acoes)
      VALUES ('xxx.f', 'X', 'g', 'f', '/f', 1, '{consultar}')`);
    await expect(app.query(`UPDATE modulo SET ativo = false WHERE codigo = 'X'`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE funcionalidade SET ativo = false WHERE codigo = 'xxx.f'`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE modulo SET codigo = 'Y'`)).rejects.toEqual(negado);
    await expect(app.query(`UPDATE funcionalidade SET modulo_codigo = 'X', acoes = '{consultar}'`)).rejects.toEqual(negado);
    await expect(app.query(`INSERT INTO modulo (codigo, nome, ordem) VALUES ('Z', 'Z', 1)`)).rejects.toEqual(negado);
  });

  it('sgo_app não renomeia o código do perfil', async () => {
    await migrator.query(`INSERT INTO perfil (codigo, nome, descricao) VALUES ('PX', 'PX', 'PX')`);
    await expect(app.query(`UPDATE perfil SET nome = 'Perfil X' WHERE codigo = 'PX'`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE perfil SET codigo = 'ADMIN2' WHERE codigo = 'PX'`)).rejects.toEqual(negado);
  });

  it('sgo_app não lê os padrões aplicados pela seed', async () =>
    expect(app.query('SELECT * FROM permissao_padrao_aplicada')).rejects.toEqual(negado));

  it('sgo_sync não lê usuário nem perfil', async () => {
    await expect(sync.query('SELECT * FROM usuario')).rejects.toEqual(negado);
    await expect(sync.query('SELECT * FROM perfil_permissao')).rejects.toEqual(negado);
  });

  it('linha única e ação válida', async () => {
    await expect(migrator.query('INSERT INTO configuracao_acesso (id) VALUES (2)')).rejects.toEqual(
      expect.objectContaining({ code: '23514' }),
    );
    await migrator.query(`INSERT INTO modulo (codigo, nome, ordem) VALUES ('M', 'M', 1)`);
    await migrator.query(`INSERT INTO funcionalidade (codigo, modulo_codigo, grupo, nome, rota, ordem, acoes)
      VALUES ('mmm.f', 'M', 'g', 'f', '/f', 1, '{consultar}')`);
    await expect(
      migrator.query(`INSERT INTO funcionalidade (codigo, modulo_codigo, grupo, nome, rota, ordem, acoes)
        VALUES ('mmm.g', 'M', 'g', 'g', '/g', 1, '{voar}')`),
    ).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    const { rows } = await migrator.query(`INSERT INTO perfil (codigo, nome, descricao) VALUES ('P', 'P', 'P') RETURNING id`);
    await expect(
      migrator.query(`INSERT INTO perfil_permissao (perfil_id, funcionalidade_codigo, acao) VALUES ($1, 'mmm.f', 'voar')`, [
        (rows[0] as { id: string }).id,
      ]),
    ).rejects.toEqual(expect.objectContaining({ code: '23514' }));
  });
});
