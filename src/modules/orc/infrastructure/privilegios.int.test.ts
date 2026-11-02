import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Matriz de privilégios das tabelas do orc (migration 202610260700_orc_orcamento; plano do P6,
// Task 1). Privilégio a mais ou a menos reprova, inclusive TRUNCATE, TRIGGER e REFERENCES.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: pg.Client;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
});

afterAll(async () => {
  try {
    await migrator?.end();
  } finally {
    await banco?.parar();
  }
});

const TODOS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const ESPERADO_APP: Record<string, string[]> = {
  orc_exercicio: ['INSERT', 'SELECT'],
  orc_posicao: TODOS,
  orc_pacote: TODOS,
  orc_linha: TODOS,
  orc_receita: TODOS,
  orc_importacao: ['INSERT', 'SELECT'],
  orc_tramite: ['INSERT', 'SELECT'],
  orc_snapshot: ['INSERT', 'SELECT'],
};

async function privilegios(papel: string): Promise<Record<string, string[]>> {
  const r = await migrator.query<{ tabela: string; privilegio: string }>(
    `SELECT table_name AS tabela, privilege_type AS privilegio FROM information_schema.table_privileges
     WHERE grantee = $1 AND table_name LIKE 'orc\\_%' ORDER BY 1, 2`,
    [papel],
  );
  const m: Record<string, string[]> = {};
  for (const { tabela, privilegio } of r.rows) (m[tabela] ??= []).push(privilegio);
  return m;
}

describe('privilégios do orc', () => {
  it('sgo_app: a matriz exata da Task 1, sem TRUNCATE, TRIGGER nem REFERENCES', async () => {
    const atual = await privilegios('sgo_app');
    const ordenado = Object.fromEntries(Object.entries(ESPERADO_APP).map(([t, p]) => [t, [...p].sort()]));
    expect(atual).toEqual(ordenado);
  });

  it('sgo_app só atualiza as colunas do ciclo e do teto no exercício (o ano nunca muda)', async () => {
    const r = await migrator.query<{ coluna: string }>(
      `SELECT column_name AS coluna FROM information_schema.column_privileges
       WHERE grantee = 'sgo_app' AND table_name = 'orc_exercicio' AND privilege_type = 'UPDATE' ORDER BY 1`,
    );
    expect(r.rows.map((x) => x.coluna)).toEqual([
      'atualizado_em', 'enviado_por', 'oficializado_em', 'situacao', 'teto_justificativa', 'teto_manual', 'versao', 'versao_premissas',
    ]);
  });

  it('sgo_sync: nada no orc', async () => expect(await privilegios('sgo_sync')).toEqual({}));
});
