import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_PLANO_CONTAS } from '../domain/plano-contas';
import oficial from '../infrastructure/dados/plano-contas-oficial.json';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { acaoConsultarCargaPlano, acaoImportarPlanoContas } = await import('./acoes-plano');

// Ações da importação do plano de contas (plano do P4, Task 7a, Step 1), pela definirAcao, com o
// FormData da tela e o prisma padrão (sgo_app) num Postgres real (Testcontainers, D12).
type Celulas = Record<(typeof COLUNAS_PLANO_CONTAS)[number], string | null>;
const OFICIAL = (oficial as { numero: number; celulas: Celulas }[]).map((l) => l.celulas);

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
let usuarioId: string;
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const permissoes = (...p: [string, string][]) => new Set(p.map(([f, a]) => `${f}:${a}`));
const gfin = () => ({
  usuarioId,
  usuarioRotulo: 'gfin',
  sessaoUid: 's-gfin',
  ip: '203.0.113.1',
  permissoes: permissoes(['cad.plano_contas', 'consultar'], ['cad.plano_contas', 'executar'], ['cad.centros_custo', 'executar']),
});
const orcamentista = () => ({ ...gfin(), usuarioRotulo: 'orc', permissoes: permissoes(['cad.plano_contas', 'consultar']) });

async function planilha(linhas: readonly Celulas[] = OFICIAL): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plano de Contas');
  ws.addRow([...COLUNAS_PLANO_CONTAS]);
  for (const l of linhas) ws.addRow(COLUNAS_PLANO_CONTAS.map((c) => l[c]));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function formulario(conteudo: Uint8Array, nome = 'Plano_de_Contas.xlsx'): FormData {
  const f = new FormData();
  f.append('arquivo', new File([conteudo as BlobPart], nome));
  return f;
}

const lotes = async () => Number((await migrator.query('SELECT count(*) AS n FROM carga_estrutura')).rows[0].n);
const campos = (r: { ok: boolean; erros?: readonly { campo: string }[] }) => (r.ok ? [] : (r.erros ?? []).map((e) => e.campo));

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  global_.__sgoPrisma = app; // as ações usam o prisma padrão (sgo_app)
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Gestor Financeiro', 'gfin@exemplo.org', 'gfin', 'gfin', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  try {
    await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  } finally {
    delete global_.__sgoPrisma;
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.query('DELETE FROM carga_estrutura');
  contexto = gfin();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('acaoImportarPlanoContas', () => {
  it('GFIN com a planilha oficial: ok, o id do lote e o lote PENDENTE', async () => {
    const r = await acaoImportarPlanoContas(formulario(await planilha()));
    if (!r.ok) throw new Error(JSON.stringify(r.erros.slice(0, 3)));
    expect(r.valor.cargaId).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await migrator.query('SELECT tipo, situacao, linhas FROM carga_estrutura WHERE id = $1', [r.valor.cargaId]);
    expect(rows).toEqual([{ tipo: 'PLANO_CONTAS', situacao: 'PENDENTE', linhas: OFICIAL.length }]);
  });

  it('orçamentista (só consultar): 403 auditado, sem lote', async () => {
    contexto = orcamentista();
    expect(await acaoImportarPlanoContas(formulario(await planilha()))).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.plano_contas' })]);
    expect(await lotes()).toBe(0);
  });

  it('.csv, arquivo sem a assinatura PK e 1,5 MB: erro em arquivo, sem lote', async () => {
    const valida = await planilha();
    expect(campos(await acaoImportarPlanoContas(formulario(valida, 'plano.csv')))).toEqual(['arquivo']);
    expect(campos(await acaoImportarPlanoContas(formulario(new TextEncoder().encode('Classificação;Nível\n1;1\n'))))).toEqual(['arquivo']);
    expect(campos(await acaoImportarPlanoContas(formulario(new Uint8Array(1.5 * 1024 * 1024))))).toEqual(['arquivo']);
    expect(campos(await acaoImportarPlanoContas(new FormData()))).toEqual(['arquivo']);
    expect(await lotes()).toBe(0);
  });

  it('planilha com erro de linha: linhas.<n>.<coluna>, sem lote', async () => {
    const comErro = OFICIAL.map((l, i) => (i === 3 ? { ...l, ['Nível']: '9' } : l));
    const r = await acaoImportarPlanoContas(formulario(await planilha(comErro)));
    expect(r.ok).toBe(false);
    expect(campos(r)).toContain('linhas.5.Nível');
    expect(await lotes()).toBe(0);
  });
});

describe('acaoConsultarCargaPlano (M-n1)', () => {
  it('o lote do plano volta; o de centros de custo, mesmo com a permissão, volta null', async () => {
    const r = await acaoImportarPlanoContas(formulario(await planilha()));
    if (!r.ok) throw new Error('importação recusada');
    expect(await acaoConsultarCargaPlano({ cargaId: r.valor.cargaId })).toMatchObject({ ok: true, valor: { situacao: 'PENDENTE', tipo: 'PLANO_CONTAS' } });

    const { rows } = await migrator.query(`INSERT INTO carga_estrutura (id, tipo, arquivo_nome, arquivo_sha256, linhas, contexto_auditoria)
      VALUES (gen_random_uuid(), 'CENTROS_CUSTO', 'cc.xlsx', repeat('0', 64), 1, '{}'::jsonb) RETURNING id`);
    expect(await acaoConsultarCargaPlano({ cargaId: rows[0].id })).toEqual({ ok: true, valor: null });
    expect(await acaoConsultarCargaPlano({ cargaId: 'nao-e-uuid' })).toEqual({ ok: true, valor: null });
  });

  it('sem executar: 403 auditado', async () => {
    contexto = orcamentista();
    expect(await acaoConsultarCargaPlano({ cargaId: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d' })).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toHaveLength(1);
  });
});
