import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditar, type EventoAuditoria } from '@/shared/audit';
import { criarPrisma } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from './banco';

// Histórico de Operações append-only, gravado na transação da operação (US-006).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let sync: pg.Client;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const UNIDADE = '6a7c1d2e-3f40-4b51-8c62-7d83e94fa0b1';

const evento: EventoAuditoria = {
  contexto: { usuarioId: USUARIO, usuarioRotulo: 'admin', sessaoUid: 's1', ip: '127.0.0.1', unidadeId: UNIDADE },
  funcionalidade: 'Usuários',
  tipo: 'INSERCAO',
  registroId: '42',
  depois: { nome: 'Ana', salario: Dinheiro.de('1234.5'), senhaHash: 'segredo' },
};

async function total(): Promise<number> {
  const { rows } = await migrator.query('SELECT count(*)::int AS n FROM historico_operacao');
  return (rows[0] as { n: number }).n;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  sync = new pg.Client({ connectionString: banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync') });
  await Promise.all([migrator.connect(), sync.connect()]);
  await migrator.query('CREATE TABLE t_operacao (id int PRIMARY KEY)');
  app = criarPrisma(banco.urlApp);
  // Uma linha garantida para os testes de UPDATE/DELETE (triggers por linha precisam de linha).
  await app.$transaction((tx) => auditar(tx, { ...evento, registroId: 'base' }));
});

afterAll(async () => {
  try {
    await Promise.allSettled([app?.$disconnect(), migrator?.end(), sync?.end()]);
  } finally {
    await banco?.parar();
  }
});

describe('auditar', () => {
  it('grava todos os campos na transação, sem a credencial', async () => {
    await app.$transaction((tx) => auditar(tx, { ...evento, origem: 'SUGESTAO_IA' }));
    const { rows } = await migrator.query(
      `SELECT unidade_id, usuario_id, usuario_rotulo, sessao_uid, ip::text AS ip, funcionalidade,
              tipo_operacao, registro_id, descricao, antes, depois, delta, origem
         FROM historico_operacao WHERE registro_id = '42'`,
    );
    expect(rows).toEqual([
      {
        unidade_id: UNIDADE,
        usuario_id: USUARIO,
        usuario_rotulo: 'admin',
        sessao_uid: 's1',
        ip: '127.0.0.1/32',
        funcionalidade: 'Usuários',
        tipo_operacao: 'INSERCAO',
        registro_id: '42',
        descricao: 'Inseriu o registro 42 referente à Usuários',
        antes: null,
        depois: { nome: 'Ana', salario: '1234.50', senhaHash: '[omitido]' },
        delta: { nome: { para: 'Ana' }, salario: { para: '1234.50' }, senhaHash: { para: '[omitido]' } },
        origem: 'SUGESTAO_IA',
      },
    ]);
  });

  it('consulta sem dados grava antes, depois e delta como NULL do banco e usa a descrição informada', async () => {
    await app.$transaction((tx) =>
      auditar(tx, { ...evento, tipo: 'CONSULTA', registroId: 'c1', depois: undefined, descricao: 'Abriu a tela' }),
    );
    const { rows } = await migrator.query(
      "SELECT antes IS NULL AS a, depois IS NULL AS d, delta IS NULL AS x, descricao FROM historico_operacao WHERE registro_id = 'c1'",
    );
    expect(rows).toEqual([{ a: true, d: true, x: true, descricao: 'Abriu a tela' }]);
  });

  it('sgo_app e sgo_sync não alteram, apagam nem truncam o histórico (privilégio)', async () => {
    for (const sql of ["UPDATE historico_operacao SET descricao = 'x'", 'DELETE FROM historico_operacao', 'TRUNCATE historico_operacao']) {
      await expect(app.$executeRawUnsafe(sql)).rejects.toThrow(/permission denied/);
      await expect(sync.query(sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('sgo_app e sgo_sync não forjam id nem data (o servidor decide)', async () => {
    const colunas = "usuario_rotulo, funcionalidade, tipo_operacao, descricao";
    const valores = "'x', 'F', 'SISTEMA', 'd'";
    await expect(
      app.$executeRawUnsafe(`INSERT INTO historico_operacao (id, ${colunas}) VALUES (999999, ${valores})`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sync.query(`INSERT INTO historico_operacao (ocorrido_em, ${colunas}) VALUES ('2000-01-01', ${valores})`),
    ).rejects.toThrow(/permission denied/);
  });

  it('nem o migrator altera, apaga ou trunca o histórico (trigger)', async () => {
    await expect(migrator.query("UPDATE historico_operacao SET descricao = 'x'")).rejects.toThrow(/somente inserção/);
    await expect(migrator.query('DELETE FROM historico_operacao')).rejects.toThrow(/somente inserção/);
    await expect(migrator.query('TRUNCATE historico_operacao')).rejects.toThrow(/somente inserção/);
  });

  it('falha na auditoria desfaz a operação', async () => {
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO t_operacao VALUES (1)`;
        await auditar(tx, { ...evento, funcionalidade: '' });
      }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'AUDITORIA_INVALIDA' }));
    const { rows } = await migrator.query('SELECT count(*)::int AS n FROM t_operacao');
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('falha da operação depois de auditar desfaz também o histórico (mesma transação)', async () => {
    const antes = await total();
    await expect(
      app.$transaction(async (tx) => {
        await auditar(tx, { ...evento, registroId: 'r1' });
        throw new Error('operação falhou depois');
      }),
    ).rejects.toThrow('operação falhou depois');
    expect(await total()).toBe(antes);
  });
});

describe('auditar fora da transação', () => {
  it('recusa o cliente raiz do Prisma', async () => {
    await expect(auditar(app as never, evento)).rejects.toThrow(
      expect.objectContaining({ codigo: 'AUDITORIA_FORA_DA_TRANSACAO' }),
    );
  });
});
