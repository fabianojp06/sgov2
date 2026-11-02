import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Privilégios das tabelas do cad (migration 202611021000_cad_plano_contas; plano do P4, R6).
// A matriz do information_schema tem de ser exatamente a tabela da R6.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: pg.Client;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
}, 180_000);

afterAll(async () => {
  try {
    await migrator?.end();
  } finally {
    await banco?.parar();
  }
});

const TABELAS = ['conta_contabil', 'carga_estrutura', 'carga_estrutura_linha'];
const PAPEIS = ['sgo_app', 'sgo_sync', 'sgo_fila', 'sgo_leitura'];

describe('privilégios do cad (R6)', () => {
  it('na tabela: o app só lê a estrutura e o lote e grava o staging; o sync faz o merge; ninguém apaga estrutura', async () => {
    const { rows } = await migrator.query<{ tabela: string; papel: string; privilegio: string }>(
      `SELECT table_name AS tabela, grantee AS papel, privilege_type AS privilegio FROM information_schema.role_table_grants
       WHERE table_name = ANY($1) AND grantee = ANY($2) ORDER BY 1, 2, 3`,
      [TABELAS, PAPEIS],
    );
    expect(rows.map((r) => `${r.tabela} ${r.papel} ${r.privilegio}`)).toEqual([
      'carga_estrutura sgo_app SELECT',
      'carga_estrutura sgo_sync SELECT',
      'carga_estrutura sgo_sync UPDATE',
      'carga_estrutura_linha sgo_app INSERT',
      'carga_estrutura_linha sgo_sync DELETE',
      'carga_estrutura_linha sgo_sync SELECT',
      'conta_contabil sgo_app SELECT',
      'conta_contabil sgo_sync INSERT',
      'conta_contabil sgo_sync SELECT',
      'conta_contabil sgo_sync UPDATE',
    ]);
  });

  it('nas colunas: o INSERT do app no lote é só nas colunas de entrada (S-N3)', async () => {
    const { rows } = await migrator.query<{ coluna: string }>(
      `SELECT column_name AS coluna FROM information_schema.column_privileges
       WHERE table_name = 'carga_estrutura' AND grantee = 'sgo_app' AND privilege_type = 'INSERT' ORDER BY 1`,
    );
    expect(rows.map((r) => r.coluna)).toEqual(
      ['aprovacao_data', 'aprovacao_documento', 'arquivo_nome', 'arquivo_sha256', 'contexto_auditoria', 'id', 'linhas', 'provisoria', 'tipo'].sort(),
    );
  });

  it('o lote nasce PENDENTE, sem resultado, com o grupo do tipo; terminado não muda', async () => {
    const insere = (extra = '') =>
      migrator.query(
        `INSERT INTO carga_estrutura (tipo, arquivo_nome, arquivo_sha256, linhas, contexto_auditoria${extra ? ', incluidas' : ''})
         VALUES ('CARGOS_RECIFRA', 'a.xlsx', 'x', 1, '{}'${extra}) RETURNING id, grupo, situacao`,
      );
    await expect(insere(', 5')).rejects.toThrow(/nasce PENDENTE/);
    const { rows } = await insere();
    expect(rows[0]).toMatchObject({ grupo: 'CARGOS', situacao: 'PENDENTE' });
    // Outro do mesmo grupo em andamento é recusado pelo índice parcial (m5).
    await expect(migrator.query(`INSERT INTO carga_estrutura (tipo, arquivo_nome, arquivo_sha256, linhas, contexto_auditoria)
      VALUES ('CARGOS', 'b.xlsx', 'y', 1, '{}')`)).rejects.toThrow(/carga_estrutura_grupo_andamento_key/);
    await migrator.query(`UPDATE carga_estrutura SET situacao = 'FALHOU', erro = 'teste' WHERE id = $1`, [rows[0].id]);
    await expect(migrator.query(`UPDATE carga_estrutura SET situacao = 'PENDENTE' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/terminado não muda/);
  });
});
