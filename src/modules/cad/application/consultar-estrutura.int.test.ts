import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_PLANO_CONTAS } from '../domain/plano-contas';
import oficial from '../infrastructure/dados/plano-contas-oficial.json';
import { iniciarProcessadorCargas } from '../infrastructure/processador-cargas';
import type { NoContaTela } from '../ui/arvore-contas-logica';
import { consultarArvoreContas } from './consultar-estrutura';
import { solicitarCargaPlanoContas } from './importar-estrutura';

// Consulta do plano de contas em árvore (plano do P4, Task 7b, Step 1), com o plano oficial
// carregado pelo caminho real (staging no app, merge no worker) num Postgres real (D12).
type Celulas = Record<(typeof COLUNAS_PLANO_CONTAS)[number], string | null>;
const OFICIAL = (oficial as { numero: number; celulas: Celulas }[]).map((l) => l.celulas);

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let sync: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...acoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'gfin',
  sessaoUid: 's-gfin',
  ip: '127.0.0.1',
  permissoes: new Set(acoes.map((a) => `cad.plano_contas:${a}`)),
});
const todos = (ns: readonly NoContaTela[]): NoContaTela[] => ns.flatMap((n) => [n, ...todos(n.filhos ?? [])]);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Gestor Financeiro', 'gfin@exemplo.org', 'gfin', 'gfin', 'x') RETURNING id`);
  usuarioId = rows[0].id;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plano de Contas');
  ws.addRow([...COLUNAS_PLANO_CONTAS]);
  for (const l of OFICIAL) ws.addRow(COLUNAS_PLANO_CONTAS.map((c) => l[c]));
  const r = await solicitarCargaPlanoContas(ctx('executar'), { nome: 'plano.xlsx', conteudo: new Uint8Array(await wb.xlsx.writeBuffer()) }, { cliente: app });
  if (!r.ok) throw new Error('carga recusada');
  await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
  // Uma analítica inativada (como numa carga que a retira do arquivo).
  await migrator.query(`UPDATE conta_contabil SET ativa = false, inativada_em = now() WHERE classificacao = '4.1.1.1.003'`);
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), sync?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('consultarArvoreContas (US-044)', () => {
  it('as 174 contas do plano oficial, com a inativa marcada, na ordem da classificação', async () => {
    const nos = todos(await consultarArvoreContas(ctx('consultar'), { cliente: app }));
    expect(nos).toHaveLength(174);
    expect(nos.filter((n) => n.linha.situacao === 'Inativa').map((n) => n.id)).toEqual(['4.1.1.1.003']);
    expect(nos.find((n) => n.id === '4.1.1.1.001')?.linha).toMatchObject({ classificacao: '4.1.1.1.001', nivel: '5', tipo: 'Analítica', situacao: 'Ativa' });
    expect(nos[0]?.linha).toMatchObject({ nivel: '1', tipo: 'Sintética', reduzido: null });
    const classificacoes = nos.map((n) => n.id);
    expect(classificacoes.indexOf('4.1.1.1.001')).toBeLessThan(classificacoes.indexOf('4.1.1.1.003'));
    // Serializável para o componente cliente.
    expect(JSON.parse(JSON.stringify(nos))).toEqual(nos);
  });

  it('sem consultar: ErroPermissao antes de ler', async () => {
    await expect(consultarArvoreContas(ctx(), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });
});
