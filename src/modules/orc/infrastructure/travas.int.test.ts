import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Travas no banco do orc (plano do P6, Task 1): ciclo de vida da §6.2, exercício não editável em
// Em Aprovação e Oficializado, snapshot e trâmite. Valem para qualquer papel, inclusive o sgo_app.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: pg.Client;
let app: pg.Client;
let ano = 2030;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  app = new pg.Client({ connectionString: banco.urlApp });
  await Promise.all([migrator.connect(), app.connect()]);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.end(), app?.end()]);
  } finally {
    await banco?.parar();
  }
});

const MESES = `ARRAY[${Array(12).fill('1.00').join(',')}]::numeric(15,2)[]`;
const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const negadoPor = (mensagem: string) => expect.objectContaining({ message: mensagem });
const negado = expect.objectContaining({ code: '42501' });

async function exercicio(...situacoes: string[]): Promise<string> {
  const { rows } = await app.query<{ id: string }>('INSERT INTO orc_exercicio (ano) VALUES ($1) RETURNING id', [ano++]);
  const id = rows[0]!.id;
  for (const s of situacoes) await app.query('UPDATE orc_exercicio SET situacao = $1 WHERE id = $2', [s, id]);
  return id;
}

const posicao = (exercicioId: string, cliente = app) =>
  cliente.query(
    `INSERT INTO orc_posicao (exercicio_id, cc, cargo, quantidade, salario_mensal, mes_inicio, mes_saida, origem)
     VALUES ($1, '4.4', 'Analista', 1, 1000, 1, 12, 'IMPORTACAO') RETURNING id`,
    [exercicioId],
  );
const receita = (exercicioId: string, tp: string) =>
  app.query(`INSERT INTO orc_receita (exercicio_id, tp, descricao, situacao, meses, total) VALUES ($1, $2, '', 'CONFIRMADO', ${MESES}, 12) RETURNING id`, [
    exercicioId,
    tp,
  ]);
const importacao = (exercicioId: string) =>
  app.query(`INSERT INTO orc_importacao (exercicio_id, arquivo_nome, arquivo_sha256, resumo, criado_por) VALUES ($1, 'a.xlsx', $2, '{}', $3)`, [
    exercicioId,
    'a'.repeat(64),
    USUARIO,
  ]);
const tramite = (exercicioId: string, de: string, para: string) =>
  app.query('INSERT INTO orc_tramite (exercicio_id, de, para, usuario_id) VALUES ($1, $2, $3, $4)', [exercicioId, de, para, USUARIO]);
const snapshot = (exercicioId: string) =>
  app.query(`INSERT INTO orc_snapshot (exercicio_id, sha256, conteudo) VALUES ($1, $2, '{}')`, [exercicioId, 'b'.repeat(64)]);

describe('ciclo de vida do exercício (§6.2)', () => {
  it('nasce em Rascunho e segue só as transições previstas, inclusive a rejeição', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    const { rows } = await app.query('SELECT situacao FROM orc_exercicio WHERE id = $1', [id]);
    expect(rows[0].situacao).toBe('OFICIALIZADO');
  });

  it('INSERT fora de Rascunho e transição fora da §6.2 são recusados', async () => {
    await expect(app.query(`INSERT INTO orc_exercicio (ano, situacao) VALUES (2098, 'OFICIALIZADO')`)).rejects.toEqual(
      negadoPor('orc.transicao_invalida'),
    );
    const id = await exercicio();
    await expect(app.query(`UPDATE orc_exercicio SET situacao = 'OFICIALIZADO' WHERE id = $1`, [id])).rejects.toEqual(
      negadoPor('orc.transicao_invalida'),
    );
    await expect(app.query(`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = $1`, [id])).rejects.toEqual(
      negadoPor('orc.transicao_invalida'),
    );
  });

  it('Em Aprovação: teto e versão das premissas não mudam; o trâmite muda', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO');
    await expect(app.query('UPDATE orc_exercicio SET teto_manual = 1 WHERE id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    await expect(app.query('UPDATE orc_exercicio SET versao_premissas = 9 WHERE id = $1', [id])).rejects.toEqual(
      negadoPor('orc.exercicio_nao_editavel'),
    );
    await expect(app.query(`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO', versao = versao + 1 WHERE id = $1`, [id])).resolves.toBeDefined();
  });

  it('Oficializado: nada muda no exercício, nem pelo migrator', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(app.query('UPDATE orc_exercicio SET versao = versao + 1 WHERE id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_oficializado'));
    await expect(migrator.query('DELETE FROM orc_exercicio WHERE id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_oficializado'));
  });

  it('o sgo_app não muda o ano nem apaga exercício', async () => {
    const id = await exercicio();
    await expect(app.query('UPDATE orc_exercicio SET ano = 2099 WHERE id = $1', [id])).rejects.toEqual(negado);
    await expect(app.query('DELETE FROM orc_exercicio WHERE id = $1', [id])).rejects.toEqual(negado);
  });
});

describe('exercício não editável', () => {
  it('Em Aprovação: posição e importação recusadas', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO');
    await expect(posicao(id)).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    await expect(importacao(id)).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
  });

  it('Oficializado: linha e receita não são apagadas nem movidas para um exercício editável', async () => {
    const editavel = await exercicio();
    const id = await exercicio();
    const p = (await posicao(id)).rows[0].id as string;
    await app.query(
      `INSERT INTO orc_linha (exercicio_id, cc, conta, origem, posicao_id, meses, total) VALUES ($1, '4.4', '4.1.1.1.001', 'PESSOAL', $2, ${MESES}, 12)`,
      [id, p],
    );
    const r = (await receita(id, '001/2026')).rows[0].id as string;
    await app.query(`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = $1`, [id]);
    await app.query(`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = $1`, [id]);
    await app.query(`UPDATE orc_exercicio SET situacao = 'OFICIALIZADO' WHERE id = $1`, [id]);
    await expect(app.query('DELETE FROM orc_linha WHERE exercicio_id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    await expect(app.query('DELETE FROM orc_receita WHERE id = $1', [r])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    await expect(app.query('UPDATE orc_receita SET exercicio_id = $1 WHERE id = $2', [editavel, r])).rejects.toEqual(
      negadoPor('orc.exercicio_nao_editavel'),
    );
    await expect(app.query('DELETE FROM orc_posicao WHERE id = $1', [p])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
  });
});

describe('snapshot e trâmite', () => {
  it('snapshot só de exercício oficializado, e o sgo_app não o apaga nem altera', async () => {
    const rascunho = await exercicio();
    await expect(snapshot(rascunho)).rejects.toEqual(negadoPor('orc.snapshot_sem_oficializacao'));
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(snapshot(id)).resolves.toBeDefined();
    await expect(app.query('DELETE FROM orc_snapshot WHERE exercicio_id = $1', [id])).rejects.toEqual(negado);
    await expect(app.query(`UPDATE orc_snapshot SET conteudo = '{"x":1}' WHERE exercicio_id = $1`, [id])).rejects.toEqual(negado);
  });

  it('trâmite de exercício oficializado só o da oficialização', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(tramite(id, 'EM_APROVACAO', 'OFICIALIZADO')).resolves.toBeDefined();
    await expect(tramite(id, 'OFICIALIZADO', 'EM_ELABORACAO')).rejects.toEqual(negadoPor('orc.exercicio_oficializado'));
  });
});

describe('domínios (CHECK)', () => {
  it('séries de 12 meses, meses da posição, pacote pontual com mês, receita sem negativo e linha com a origem certa', async () => {
    const id = await exercicio();
    const p = (await posicao(id)).rows[0].id as string;
    const linha = (meses: string, origem = 'PESSOAL', extra = '') =>
      app.query(`INSERT INTO orc_linha (exercicio_id, cc, conta, origem, posicao_id, meses, total${extra ? ', pacote_id' : ''})
        VALUES ($1, '4.4', '4.1.1.1.001', '${origem}', $2, ${meses}, 12${extra})`, [id, p]);
    await expect(linha(`ARRAY[${Array(11).fill('1').join(',')}]::numeric(15,2)[]`)).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    await expect(linha('NULL')).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    await expect(linha(MESES, 'BASE_ZERO')).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    await expect(
      app.query(`INSERT INTO orc_posicao (exercicio_id, cc, cargo, quantidade, salario_mensal, mes_inicio, mes_saida, origem)
        VALUES ($1, '4.4', 'X', 1, 1000, 5, 4, 'IMPORTACAO')`, [id]),
    ).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    await expect(
      app.query(`INSERT INTO orc_pacote (exercicio_id, cc, conta, justificativa, prioridade, quantidade, valor_unitario, corrigir_ipca, distribuicao, origem)
        VALUES ($1, '4.4', '4.1.1.5.005', 'Justificativa longa', 'ESSENCIAL', 1, 10, false, 'PONTUAL', 'IMPORTACAO')`, [id]),
    ).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    await expect(
      app.query(`INSERT INTO orc_receita (exercicio_id, tp, descricao, situacao, meses, total)
        VALUES ($1, 'TP', '', 'CONFIRMADO', ARRAY[-1,0,0,0,0,0,0,0,0,0,0,0]::numeric(15,2)[], -1)`, [id]),
    ).rejects.toEqual(expect.objectContaining({ code: '23514' }));
  });
});
