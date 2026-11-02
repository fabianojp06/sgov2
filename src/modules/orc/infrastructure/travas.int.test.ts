import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Travas no banco do orc (plano do P6, Task 1): ciclo de vida da §6.2, exercício não editável em
// Em Aprovação e Oficializado, oficialização completa, trâmite e snapshot só na transação da
// mudança. Valem para qualquer papel, inclusive o sgo_app.
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
const violou = (constraint: string) => expect.objectContaining({ code: '23514', constraint });

async function emTransacao<T>(f: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    const r = await f();
    await app.query('COMMIT');
    return r;
  } catch (erro) {
    await app.query('ROLLBACK');
    throw erro;
  }
}

const tramite = (exercicioId: string, de: string, para: string) =>
  app.query('INSERT INTO orc_tramite (exercicio_id, de, para, usuario_id) VALUES ($1, $2, $3, $4)', [exercicioId, de, para, USUARIO]);
const snapshot = (exercicioId: string) =>
  app.query(`INSERT INTO orc_snapshot (exercicio_id, sha256, conteudo) VALUES ($1, $2, '{}')`, [exercicioId, 'b'.repeat(64)]);

// Cada transição como a aplicação faz: UPDATE e trâmite na mesma transação; a oficialização com
// a data, o snapshot e o trâmite.
async function transitar(id: string, de: string, para: string): Promise<void> {
  await emTransacao(async () => {
    const oficializar = para === 'OFICIALIZADO';
    await app.query(
      `UPDATE orc_exercicio SET situacao = $1, versao = versao + 1${oficializar ? ', oficializado_em = clock_timestamp()' : ''} WHERE id = $2`,
      [para, id],
    );
    if (oficializar) await snapshot(id);
    await tramite(id, de, para);
  });
}

async function exercicio(...situacoes: string[]): Promise<string> {
  const { rows } = await app.query<{ id: string }>('INSERT INTO orc_exercicio (ano) VALUES ($1) RETURNING id', [ano++]);
  const id = rows[0]!.id;
  let de = 'RASCUNHO';
  for (const para of situacoes) {
    await transitar(id, de, para);
    de = para;
  }
  return id;
}

const posicao = (exercicioId: string) =>
  app.query<{ id: string }>(
    `INSERT INTO orc_posicao (exercicio_id, cc, cargo, quantidade, salario_mensal, mes_inicio, mes_saida, origem)
     VALUES ($1, '4.4', 'Analista', 1, 1000, 1, 12, 'IMPORTACAO') RETURNING id`,
    [exercicioId],
  );
const pacote = (exercicioId: string) =>
  app.query<{ id: string }>(
    `INSERT INTO orc_pacote (exercicio_id, cc, conta, justificativa, prioridade, quantidade, valor_unitario, corrigir_ipca, distribuicao, origem)
     VALUES ($1, '4.4', '4.1.1.5.005', 'Reposição de material', 'ESSENCIAL', 1, 10, false, 'MENSAL', 'IMPORTACAO') RETURNING id`,
    [exercicioId],
  );
const linha = (exercicioId: string, origem: string, refs: { posicao?: string; pacote?: string }, componente: string | null, meses = MESES) =>
  app.query(
    `INSERT INTO orc_linha (exercicio_id, cc, conta, origem, componente, posicao_id, pacote_id, meses, total)
     VALUES ($1, '4.4', '4.1.1.1.001', $2, $3, $4, $5, ${meses}, 12)`,
    [exercicioId, origem, componente, refs.posicao ?? null, refs.pacote ?? null],
  );
const receita = (exercicioId: string, tp: string) =>
  app.query<{ id: string }>(
    `INSERT INTO orc_receita (exercicio_id, tp, descricao, situacao, meses, total) VALUES ($1, $2, '', 'CONFIRMADO', ${MESES}, 12) RETURNING id`,
    [exercicioId, tp],
  );
const importacao = (exercicioId: string) =>
  app.query(`INSERT INTO orc_importacao (exercicio_id, arquivo_nome, arquivo_sha256, resumo, criado_por) VALUES ($1, 'a.xlsx', $2, '{}', $3)`, [
    exercicioId,
    'a'.repeat(64),
    USUARIO,
  ]);

describe('ciclo de vida do exercício (§6.2)', () => {
  it('nasce em Rascunho e segue só as transições previstas, inclusive a rejeição', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    const { rows } = await app.query('SELECT situacao FROM orc_exercicio WHERE id = $1', [id]);
    expect(rows[0].situacao).toBe('OFICIALIZADO');
  });

  it('INSERT fora de Rascunho, com versão ou com remetente é recusado', async () => {
    await expect(app.query(`INSERT INTO orc_exercicio (ano, situacao) VALUES (2098, 'EM_ELABORACAO')`)).rejects.toEqual(
      negadoPor('orc.transicao_invalida'),
    );
    await expect(app.query('INSERT INTO orc_exercicio (ano, versao) VALUES (2097, 5)')).rejects.toEqual(negadoPor('orc.transicao_invalida'));
    await expect(app.query('INSERT INTO orc_exercicio (ano, enviado_por) VALUES (2096, $1)', [USUARIO])).rejects.toEqual(
      negadoPor('orc.transicao_invalida'),
    );
  });

  it('transição fora da §6.2 e versão que volta são recusadas', async () => {
    const id = await exercicio();
    await expect(app.query(`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = $1`, [id])).rejects.toEqual(
      negadoPor('orc.transicao_invalida'),
    );
    await app.query('UPDATE orc_exercicio SET versao = 3 WHERE id = $1', [id]);
    await expect(app.query('UPDATE orc_exercicio SET versao = 2 WHERE id = $1', [id])).rejects.toEqual(negadoPor('orc.versao_regressiva'));
  });

  it('Em Aprovação: teto, premissas e remetente não mudam; situação e versão mudam', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO');
    for (const set of ['teto_manual = 1', 'versao_premissas = 9', `enviado_por = '${USUARIO}'`]) {
      await expect(app.query(`UPDATE orc_exercicio SET ${set} WHERE id = $1`, [id])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    }
    // A lista do que pode mudar vale até para o dono: coluna fora dela fica travada.
    await expect(migrator.query('UPDATE orc_exercicio SET criado_em = criado_em - interval \'1 day\' WHERE id = $1', [id])).rejects.toEqual(
      negadoPor('orc.exercicio_nao_editavel'),
    );
    await expect(transitar(id, 'EM_APROVACAO', 'EM_ELABORACAO')).resolves.toBeUndefined();
  });

  it('Oficializado: nada muda no exercício, nem pelo migrator; data da oficialização exigida', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(app.query('UPDATE orc_exercicio SET versao = versao + 1 WHERE id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_oficializado'));
    await expect(migrator.query('DELETE FROM orc_exercicio WHERE id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_oficializado'));
    const outro = await exercicio('EM_ELABORACAO', 'EM_APROVACAO');
    await expect(app.query(`UPDATE orc_exercicio SET situacao = 'OFICIALIZADO' WHERE id = $1`, [outro])).rejects.toEqual(
      violou('orc_exercicio_oficializado_check'),
    );
  });

  it('oficialização sem snapshot ou sem trâmite é desfeita no commit (R10)', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO');
    await expect(
      emTransacao(async () => {
        await app.query(`UPDATE orc_exercicio SET situacao = 'OFICIALIZADO', oficializado_em = clock_timestamp() WHERE id = $1`, [id]);
        await tramite(id, 'EM_APROVACAO', 'OFICIALIZADO');
      }),
    ).rejects.toEqual(negadoPor('orc.oficializacao_incompleta'));
    const { rows } = await app.query('SELECT situacao FROM orc_exercicio WHERE id = $1', [id]);
    expect(rows[0].situacao).toBe('EM_APROVACAO');
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

  it('Oficializado: posição, linha e receita não são apagadas nem movidas para um exercício editável', async () => {
    const editavel = await exercicio();
    const id = await exercicio();
    const p = (await posicao(id)).rows[0]!.id;
    await linha(id, 'PESSOAL', { posicao: p }, 'salario');
    const r = (await receita(id, '001/2026')).rows[0]!.id;
    await transitar(id, 'RASCUNHO', 'EM_ELABORACAO');
    await transitar(id, 'EM_ELABORACAO', 'EM_APROVACAO');
    await transitar(id, 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(app.query('DELETE FROM orc_linha WHERE exercicio_id = $1', [id])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    await expect(app.query('DELETE FROM orc_receita WHERE id = $1', [r])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
    await expect(app.query('UPDATE orc_receita SET exercicio_id = $1 WHERE id = $2', [editavel, r])).rejects.toEqual(
      negadoPor('orc.exercicio_nao_editavel'),
    );
    await expect(app.query('DELETE FROM orc_posicao WHERE id = $1', [p])).rejects.toEqual(negadoPor('orc.exercicio_nao_editavel'));
  });
});

describe('trâmite e snapshot', () => {
  it('trâmite só da transição feita na mesma transação, com o destino igual à situação', async () => {
    const id = await exercicio('EM_ELABORACAO');
    // Transação seguinte: a linha do exercício não mudou nesta transação.
    await expect(tramite(id, 'RASCUNHO', 'EM_ELABORACAO')).rejects.toEqual(negadoPor('orc.tramite_invalido'));
    const rascunho = await exercicio();
    await expect(
      emTransacao(async () => {
        await app.query('UPDATE orc_exercicio SET versao = versao + 1 WHERE id = $1', [rascunho]);
        await tramite(rascunho, 'EM_APROVACAO', 'OFICIALIZADO');
      }),
    ).rejects.toEqual(negadoPor('orc.tramite_invalido'));
  });

  it('exercício oficializado: nenhum trâmite novo, nem outro de oficialização', async () => {
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(tramite(id, 'EM_APROVACAO', 'OFICIALIZADO')).rejects.toEqual(negadoPor('orc.tramite_invalido'));
    await expect(tramite(id, 'OFICIALIZADO', 'EM_ELABORACAO')).rejects.toEqual(negadoPor('orc.tramite_invalido'));
  });

  it('snapshot só na transação da oficialização, e o sgo_app não o apaga nem altera', async () => {
    const rascunho = await exercicio();
    await expect(snapshot(rascunho)).rejects.toEqual(negadoPor('orc.snapshot_sem_oficializacao'));
    const id = await exercicio('EM_ELABORACAO', 'EM_APROVACAO', 'OFICIALIZADO');
    await expect(app.query('DELETE FROM orc_snapshot WHERE exercicio_id = $1', [id])).rejects.toEqual(negado);
    await expect(app.query(`UPDATE orc_snapshot SET conteudo = '{"x":1}' WHERE exercicio_id = $1`, [id])).rejects.toEqual(negado);
    await expect(migrator.query('DELETE FROM orc_snapshot WHERE exercicio_id = $1', [id])).resolves.toBeDefined();
    await expect(snapshot(id)).rejects.toEqual(negadoPor('orc.snapshot_sem_oficializacao'));
  });
});

describe('domínios (CHECK) e vínculos da linha', () => {
  it('linha: 12 meses sem NULL, origem com a referência certa e componente só no pessoal', async () => {
    const id = await exercicio();
    const p = (await posicao(id)).rows[0]!.id;
    const k = (await pacote(id)).rows[0]!.id;
    const onze = `ARRAY[${Array(11).fill('1').join(',')}]::numeric(15,2)[]`;
    await expect(linha(id, 'PESSOAL', { posicao: p }, 'salario', onze)).rejects.toEqual(violou('orc_linha_meses_check'));
    await expect(linha(id, 'PESSOAL', { posicao: p }, 'salario', 'NULL')).rejects.toEqual(violou('orc_linha_meses_check'));
    await expect(linha(id, 'PESSOAL', { posicao: p, pacote: k }, 'salario')).rejects.toEqual(violou('orc_linha_origem_check'));
    await expect(linha(id, 'PESSOAL', { pacote: k }, 'salario')).rejects.toEqual(violou('orc_linha_origem_check'));
    await expect(linha(id, 'BASE_ZERO', { posicao: p }, null)).rejects.toEqual(violou('orc_linha_origem_check'));
    await expect(linha(id, 'BASE_ZERO', { pacote: k }, 'salario')).rejects.toEqual(violou('orc_linha_origem_check'));
    await expect(linha(id, 'PESSOAL', { posicao: p }, null)).rejects.toEqual(violou('orc_linha_origem_check'));
    await expect(linha(id, 'BASE_ZERO', { pacote: k }, null)).resolves.toBeDefined();
  });

  it('linha não aponta para a posição ou o pacote de outro exercício', async () => {
    const a = await exercicio();
    const b = await exercicio();
    const p = (await posicao(b)).rows[0]!.id;
    const k = (await pacote(b)).rows[0]!.id;
    await expect(linha(a, 'PESSOAL', { posicao: p }, 'salario')).rejects.toEqual(negadoPor('orc.linha_de_outro_exercicio'));
    await expect(linha(a, 'BASE_ZERO', { pacote: k }, null)).rejects.toEqual(negadoPor('orc.linha_de_outro_exercicio'));
  });

  it('posição, pacote e receita: limites e textos', async () => {
    const id = await exercicio();
    const pos = (cargo: string, inicio: number, saida: number, salario = 1000) =>
      app.query(
        `INSERT INTO orc_posicao (exercicio_id, cc, cargo, quantidade, salario_mensal, mes_inicio, mes_saida, origem)
         VALUES ($1, '4.4', $2, 1, $3, $4, $5, 'IMPORTACAO')`,
        [id, cargo, salario, inicio, saida],
      );
    await expect(pos('X', 5, 4)).rejects.toEqual(violou('orc_posicao_meses_check'));
    await expect(pos('   ', 1, 12)).rejects.toEqual(violou('orc_posicao_cargo_check'));
    await expect(pos('X', 1, 12, 1000000)).rejects.toEqual(violou('orc_posicao_salario_check'));
    await expect(
      app.query(`INSERT INTO orc_pacote (exercicio_id, cc, conta, justificativa, prioridade, quantidade, valor_unitario, corrigir_ipca, distribuicao, origem)
        VALUES ($1, '4.4', '4.1.1.5.005', 'Justificativa longa', 'ESSENCIAL', 1, 10, false, 'PONTUAL', 'IMPORTACAO')`, [id]),
    ).rejects.toEqual(violou('orc_pacote_mes_check'));
    await expect(
      app.query(`INSERT INTO orc_receita (exercicio_id, tp, descricao, situacao, meses, total)
        VALUES ($1, 'TP', '', 'CONFIRMADO', ARRAY[-1,0,0,0,0,0,0,0,0,0,0,0]::numeric(15,2)[], -1)`, [id]),
    ).rejects.toEqual(violou('orc_receita_meses_check'));
    await expect(receita(id, '  ')).rejects.toEqual(violou('orc_receita_tp_check'));
  });
});
