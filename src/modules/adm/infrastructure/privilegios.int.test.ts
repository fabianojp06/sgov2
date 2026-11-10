import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Privilégios das tabelas do adm (migrations 202610260300_adm_acesso, 202610260500_adm_unidade e
// 202611101200_adm_notificacao_desempenho).
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
    await expect(app.query(`UPDATE funcionalidade SET exibir_no_menu = false`)).rejects.toEqual(negado);
    await expect(app.query(`INSERT INTO modulo (codigo, nome, ordem) VALUES ('Z', 'Z', 1)`)).rejects.toEqual(negado);
  });

  it('sgo_app não renomeia o código do perfil', async () => {
    await migrator.query(`INSERT INTO perfil (codigo, nome, descricao) VALUES ('PX', 'PX', 'PX')`);
    await expect(app.query(`UPDATE perfil SET nome = 'Perfil X' WHERE codigo = 'PX'`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE perfil SET codigo = 'ADMIN2' WHERE codigo = 'PX'`)).rejects.toEqual(negado);
  });

  // US-037 (migration 202611102000_adm_perfil_tela): versão e exclusão do perfil criado pela tela.
  it('perfil: sgo_app muda a versão e apaga perfil P_; não muda o código nem apaga padrão; sgo_sync sem acesso', async () => {
    const { rows } = await migrator.query(`INSERT INTO perfil (codigo, nome, descricao) VALUES ('P_0123456789AB', 'Da Tela', '') RETURNING id`);
    const id = (rows[0] as { id: string }).id;
    await expect(app.query(`UPDATE perfil SET versao = versao + 1 WHERE id = $1`, [id])).resolves.toBeDefined();
    await expect(app.query(`UPDATE perfil SET codigo = 'P_FFFFFFFFFFFF' WHERE id = $1`, [id])).rejects.toEqual(negado);
    await expect(app.query(`DELETE FROM perfil WHERE id = $1`, [id])).resolves.toEqual(expect.objectContaining({ rowCount: 1 }));
    await expect(app.query(`DELETE FROM perfil WHERE codigo = 'PX'`)).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    await expect(sync.query('SELECT * FROM perfil')).rejects.toEqual(negado);
  });

  it('perfil: CHECKs de nome, descrição e código e nome único sem diferenciar maiúsculas', async () => {
    const inserir = (codigo: string, nome: string, descricao = '') => migrator.query(`INSERT INTO perfil (codigo, nome, descricao) VALUES ($1, $2, $3)`, [codigo, nome, descricao]);
    const check = expect.objectContaining({ code: '23514' });
    await expect(inserir('P_000000000001', ' Espaço')).rejects.toEqual(check);
    await expect(inserir('P_000000000002', '')).rejects.toEqual(check);
    await expect(inserir('P_000000000003', 'n'.repeat(101))).rejects.toEqual(check);
    await expect(inserir('P_000000000004', 'Descrição longa', 'd'.repeat(501))).rejects.toEqual(check);
    await expect(inserir('minusculo', 'Código ruim')).rejects.toEqual(check);
    await expect(inserir('P_000000000005', 'PERFIL x')).rejects.toEqual(expect.objectContaining({ code: '23505' }));
  });

  it('sgo_app não lê os padrões aplicados pela seed', async () =>
    expect(app.query('SELECT * FROM permissao_padrao_aplicada')).rejects.toEqual(negado));

  it('unidade: sgo_app muda nome e status, mas não o código, e não apaga (§11.5)', async () => {
    await migrator.query(`INSERT INTO unidade (codigo, nome) VALUES ('TP-X', 'TP X')`);
    await expect(app.query(`UPDATE unidade SET nome = 'TP X2', ativo = false WHERE codigo = 'TP-X'`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE unidade SET codigo = 'TP-Y'`)).rejects.toEqual(negado);
    await expect(app.query('DELETE FROM unidade')).rejects.toEqual(negado);
  });

  it('usuario_unidade: sgo_app inclui e exclui o vínculo, mas não o reatribui', async () => {
    const { rows } = await migrator.query(`INSERT INTO unidade (codigo, nome) VALUES ('TP-V', 'TP V') RETURNING id`);
    const vinculo = `(SELECT id FROM usuario WHERE login = 'ana'), '${rows[0].id}'`;
    await expect(app.query(`INSERT INTO usuario_unidade (usuario_id, unidade_id) VALUES (${vinculo})`)).resolves.toBeDefined();
    await expect(app.query(`UPDATE usuario_unidade SET unidade_id = unidade_id`)).rejects.toEqual(negado);
    await expect(app.query(`DELETE FROM usuario_unidade WHERE unidade_id = '${rows[0].id}'`)).resolves.toBeDefined();
  });

  it('sgo_sync não lê unidade nem vínculo', async () => {
    await expect(sync.query('SELECT * FROM unidade')).rejects.toEqual(negado);
    await expect(sync.query('SELECT * FROM usuario_unidade')).rejects.toEqual(negado);
  });

  it('sgo_sync não lê usuário nem perfil', async () => {
    await expect(sync.query('SELECT * FROM usuario')).rejects.toEqual(negado);
    await expect(sync.query('SELECT * FROM perfil_permissao')).rejects.toEqual(negado);
  });

  it('notificação de desempenho (US-041): sgo_app inclui e só inativa; sem DELETE nem ultimo_envio_em; sgo_sync sem acesso', async () => {
    const { rows } = await app.query(`INSERT INTO adm_notificacao_desempenho (conta_classificacao, limite_percentual, frequencia_dias, usuario_id, criada_em)
      VALUES ('4.1', 80.5, 7, (SELECT id FROM usuario WHERE login = 'ana'), now()) RETURNING id`);
    const id = (rows[0] as { id: string }).id;
    await expect(app.query(`UPDATE adm_notificacao_desempenho SET ativa = false, inativada_em = now(), versao = versao + 1 WHERE id = $1`, [id])).resolves.toBeDefined();
    await expect(app.query(`UPDATE adm_notificacao_desempenho SET limite_percentual = 90`)).rejects.toEqual(negado);
    await expect(app.query(`UPDATE adm_notificacao_desempenho SET conta_classificacao = '4'`)).rejects.toEqual(negado);
    await expect(app.query(`UPDATE adm_notificacao_desempenho SET usuario_id = usuario_id`)).rejects.toEqual(negado);
    await expect(app.query(`UPDATE adm_notificacao_desempenho SET ultimo_envio_em = now()`)).rejects.toEqual(negado);
    await expect(app.query('DELETE FROM adm_notificacao_desempenho')).rejects.toEqual(negado);
    await expect(app.query('TRUNCATE adm_notificacao_desempenho')).rejects.toEqual(negado);
    await expect(sync.query('SELECT * FROM adm_notificacao_desempenho')).rejects.toEqual(negado);
  });

  // US-039 (migration 202611101100_adm_usuario_excecao): a aplicação só lê, inclui e apaga exceções.
  it('adm_usuario_excecao: sgo_app só SELECT, INSERT e DELETE; sgo_sync nada', async () => {
    const privilegio = async (papel: string, p: string) =>
      (await migrator.query<{ tem: boolean }>(`SELECT has_table_privilege($1, 'adm_usuario_excecao', $2) AS tem`, [papel, p])).rows[0]!.tem;
    const tipos = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const doApp = await Promise.all(tipos.map((t) => privilegio('sgo_app', t)));
    expect(tipos.filter((_t, i) => doApp[i])).toEqual(['SELECT', 'INSERT', 'DELETE']);
    expect(await Promise.all(tipos.map((t) => privilegio('sgo_sync', t)))).toEqual(tipos.map(() => false));
    await expect(sync.query('SELECT * FROM adm_usuario_excecao')).rejects.toEqual(negado);
    await expect(app.query(`UPDATE adm_usuario_excecao SET funcionalidade_codigo = funcionalidade_codigo`)).rejects.toEqual(negado);
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
    const { rows } = await migrator.query(`INSERT INTO perfil (codigo, nome, descricao) VALUES ('PP', 'P', 'P') RETURNING id`);
    await expect(
      migrator.query(`INSERT INTO perfil_permissao (perfil_id, funcionalidade_codigo, acao) VALUES ($1, 'mmm.f', 'voar')`, [
        (rows[0] as { id: string }).id,
      ]),
    ).rejects.toEqual(expect.objectContaining({ code: '23514' }));
  });
});
