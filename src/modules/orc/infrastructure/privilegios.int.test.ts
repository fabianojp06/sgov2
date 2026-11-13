import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';

// Matriz de privilégios das tabelas do orc (migration 202611022100_orc_orcamento; plano do P6,
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
  orc_posicao: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P12)
  orc_pacote: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P11)
  orc_linha: TODOS,
  orc_receita: TODOS,
  orc_importacao: ['INSERT', 'SELECT'],
  orc_tramite: ['INSERT', 'SELECT'],
  orc_snapshot: ['INSERT', 'SELECT'],
  orc_revisao: ['SELECT'], // INSERT e UPDATE só por coluna (US-064)
  orc_proposta: ['INSERT', 'SELECT'], // UPDATE só por coluna (P17)
  orc_versao_proposta: ['INSERT', 'SELECT'],
  orc_meta: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P19); a exclusão é física (D-P19-6)
  orc_empregado: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P20); a exclusão é física (D-P20-9)
  orc_qtde_empregado: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P20)
  orc_teto_viagem: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P21)
  orc_viagem: ['DELETE', 'INSERT', 'SELECT'], // UPDATE só por coluna (P21); a exclusão é física (D-P21-9)
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

  it('sgo_app atualiza no pacote só os dados e a versão: origem, importação e exercício ficam de fora (P11)', async () => {
    const r = await migrator.query<{ coluna: string }>(
      `SELECT column_name AS coluna FROM information_schema.column_privileges
       WHERE grantee = 'sgo_app' AND table_name = 'orc_pacote' AND privilege_type = 'UPDATE' ORDER BY 1`,
    );
    expect(r.rows.map((x) => x.coluna)).toEqual([
      'cc', 'conta', 'corrigir_ipca', 'distribuicao', 'justificativa', 'mes_ocorrencia', 'prioridade', 'quantidade', 'valor_unitario', 'versao',
    ]);
  });

  it('sgo_app atualiza na posição só os dados e a versão: origem, importação e exercício ficam de fora (P12)', async () => {
    const r = await migrator.query<{ coluna: string }>(
      `SELECT column_name AS coluna FROM information_schema.column_privileges
       WHERE grantee = 'sgo_app' AND table_name = 'orc_posicao' AND privilege_type = 'UPDATE' ORDER BY 1`,
    );
    // P15: o cargo do cadastro de C&S (cargo_id) também; a origem continua de fora.
    expect(r.rows.map((x) => x.coluna)).toEqual(['cargo', 'cargo_id', 'cc', 'mes_inicio', 'mes_saida', 'observacao', 'quantidade', 'salario_mensal', 'versao']);
  });

  it('sgo_app pede a revisão só com o exercício, a versão e quem pede, e conclui só com a situação, os achados, os avisos e a data (US-064)', async () => {
    const colunas = async (privilegio: string) =>
      (
        await migrator.query<{ coluna: string }>(
          `SELECT column_name AS coluna FROM information_schema.column_privileges
           WHERE grantee = 'sgo_app' AND table_name = 'orc_revisao' AND privilege_type = $1 ORDER BY 1`,
          [privilegio],
        )
      ).rows.map((x) => x.coluna);
    expect(await colunas('INSERT')).toEqual(['exercicio_id', 'solicitado_por', 'versao_exercicio']);
    expect(await colunas('UPDATE')).toEqual(['achados', 'avisos', 'concluido_em', 'situacao']);
  });

  it('sgo_app atualiza na proposta de TP só a exclusão lógica e a versão; na unidade, o cc nunca muda (P17)', async () => {
    const colunas = async (tabela: string) =>
      (
        await migrator.query<{ coluna: string }>(
          `SELECT column_name AS coluna FROM information_schema.column_privileges
           WHERE grantee = 'sgo_app' AND table_name = $1 AND privilege_type = 'UPDATE' ORDER BY 1`,
          [tabela],
        )
      ).rows.map((x) => x.coluna);
    expect(await colunas('orc_proposta')).toEqual(['excluida_em', 'excluida_por', 'versao']);
    expect(await colunas('orc_versao_proposta')).toEqual([]);
    // Meta (P19): o número, a versão da proposta e a unidade não mudam.
    expect(await colunas('orc_meta')).toEqual(['nome', 'observacao', 'status', 'valor', 'versao']);
    // Pessoal (P20): a versão da proposta, a meta, a ordem e a unidade não mudam.
    expect(await colunas('orc_empregado')).toEqual(['cargo_id', 'categoria', 'dependentes', 'fim', 'inicio', 'nome', 'salario_mensal', 'versao']);
    expect(await colunas('orc_qtde_empregado')).toEqual(['documento', 'fim', 'inicio', 'versao']);
    // Viagens (P21): no teto, só o valor; na viagem, a meta e as contas de passagem e de diária não mudam (RN_VIA_07).
    expect(await colunas('orc_teto_viagem')).toEqual(['valor', 'versao']);
    expect(await colunas('orc_viagem')).toEqual(['conta_transporte', 'dias', 'localidade', 'pessoas', 'valor_diaria', 'valor_passagem', 'valor_transporte', 'versao']);
    expect(await colunas('unidade')).toEqual(['ativo', 'nome']);
  });

  it('sgo_sync: nada no orc', async () => expect(await privilegios('sgo_sync')).toEqual({}));
});
