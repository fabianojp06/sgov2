import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_CENTROS_CUSTO } from '../domain/centros-custo';
import minuta from '../infrastructure/dados/cc-minuta-rev23102026.json';
import { iniciarProcessadorCargas } from '../infrastructure/processador-cargas';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { acaoConsultarCargaCc, acaoImportarCentrosCusto } = await import('./acoes-cc');

// Ações da importação dos centros de custo (plano do P4, Task 8, Step 1), pela definirAcao, com o
// FormData da tela e o prisma padrão (sgo_app) num Postgres real (Testcontainers, D12).
type Celulas = Record<(typeof COLUNAS_CENTROS_CUSTO)[number], string | null>;
const MINUTA = (minuta as { numero: number; celulas: Celulas }[]).map((l) => l.celulas);
const MSG_DIREX =
  'Informe a data e o documento de aprovação da DIREX. A carga de centros de custo em produção só acontece depois dessa aprovação (GAP-CC-001).';

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let sync: PrismaClient;
let migrator: pg.Client;
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
let usuarioId: string;
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const permissoes = (...p: [string, string][]) => new Set(p.map(([f, a]) => `${f}:${a}`));
const gfin = (): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'gfin',
  sessaoUid: 's-gfin',
  ip: '203.0.113.1',
  permissoes: permissoes(['cad.centros_custo', 'consultar'], ['cad.centros_custo', 'executar'], ['cad.plano_contas', 'executar']),
});

// Layout da minuta: títulos nas 3 primeiras linhas e o cabeçalho na 4ª.
async function planilha(linhas: readonly Celulas[] = MINUTA): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plano de Centros de Custo');
  ws.addRow(['Plano de Centros de Custo (minuta)']);
  ws.addRow(['Rev23102026']);
  ws.addRow([]);
  ws.addRow([...COLUNAS_CENTROS_CUSTO]);
  for (const l of linhas) ws.addRow(COLUNAS_CENTROS_CUSTO.map((c) => l[c]));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function formulario(aprovacao: { data: string; documento: string } | null, linhas?: readonly Celulas[]): Promise<FormData> {
  const f = new FormData();
  f.append('arquivo', new File([(await planilha(linhas)) as BlobPart], 'cc.xlsx'));
  f.append('aprovacaoData', aprovacao?.data ?? '');
  f.append('aprovacaoDocumento', aprovacao?.documento ?? '');
  return f;
}

const APROVACAO = { data: '2026-10-30', documento: 'Ata DIREX 12/2026' };
const mensagens = (r: { ok: boolean; erros?: readonly { campo: string; mensagem: string }[] }) =>
  r.ok ? [] : (r.erros ?? []).map((e) => `${e.campo}: ${e.mensagem}`);
const lote = async (id: string) =>
  (await migrator.query('SELECT provisoria, aprovacao_data::text AS data, aprovacao_documento AS documento FROM carga_estrutura WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  global_.__sgoPrisma = app; // as ações usam o prisma padrão (sgo_app)
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Gestor Financeiro', 'gfin@exemplo.org', 'gfin', 'gfin', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  try {
    await Promise.allSettled([app?.$disconnect(), sync?.$disconnect(), migrator?.end()]);
  } finally {
    delete global_.__sgoPrisma;
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.query('BEGIN');
  for (let nivel = 5; nivel >= 1; nivel--) await migrator.query('DELETE FROM centro_custo WHERE nivel = $1', [nivel]);
  await migrator.query('DELETE FROM carga_estrutura');
  await migrator.query('COMMIT');
  contexto = gfin();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
  vi.stubEnv('AMBIENTE', 'hml');
  vi.stubEnv('CC_CARGA_PROVISORIA', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('acaoImportarCentrosCusto: trava da DIREX (R16, GAP-CC-001)', () => {
  it('com a data e o documento: ok, lote aprovado (não provisório) com a aprovação gravada', async () => {
    const r = await acaoImportarCentrosCusto(await formulario(APROVACAO));
    if (!r.ok) throw new Error(JSON.stringify(r.erros.slice(0, 3)));
    expect(await lote(r.valor.cargaId)).toEqual({ provisoria: false, data: '2026-10-30', documento: 'Ata DIREX 12/2026' });
  });

  it('produção com CC_CARGA_PROVISORIA=1: a variável é ignorada, com o log, e sem aprovação a carga é recusada', async () => {
    vi.stubEnv('AMBIENTE', 'producao');
    vi.stubEnv('CC_CARGA_PROVISORIA', '1');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(mensagens(await acaoImportarCentrosCusto(await formulario(null)))).toEqual([`aprovacao: ${MSG_DIREX}`]);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('[CC_CARGA_PROVISORIA_IGNORADA]'));
    expect(Number((await migrator.query('SELECT count(*) AS n FROM carga_estrutura')).rows[0].n)).toBe(0);
  });

  it('hml com CC_CARGA_PROVISORIA=1 e sem aprovação: carga provisória', async () => {
    vi.stubEnv('CC_CARGA_PROVISORIA', '1');
    const r = await acaoImportarCentrosCusto(await formulario(null));
    if (!r.ok) throw new Error(JSON.stringify(r.erros.slice(0, 3)));
    expect(await lote(r.valor.cargaId)).toEqual({ provisoria: true, data: null, documento: null });
  });

  it.each(['0', 'true', ''])('CC_CARGA_PROVISORIA=%j exige a aprovação (M1)', async (valor) => {
    vi.stubEnv('CC_CARGA_PROVISORIA', valor);
    expect(mensagens(await acaoImportarCentrosCusto(await formulario(null)))).toEqual([`aprovacao: ${MSG_DIREX}`]);
  });

  it('produção: data e documento só com espaços contam como sem aprovação', async () => {
    vi.stubEnv('AMBIENTE', 'producao');
    expect(mensagens(await acaoImportarCentrosCusto(await formulario({ data: '   ', documento: '  ' })))).toEqual([`aprovacao: ${MSG_DIREX}`]);
  });

  it('a data com espaços em volta é aceita; antes de 2000, recusada no campo', async () => {
    const r = await acaoImportarCentrosCusto(await formulario({ data: ' 2026-10-30 ', documento: 'Ata DIREX 12/2026' }));
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect((await lote(r.valor.cargaId)).data).toBe('2026-10-30');
    await migrator.query('DELETE FROM carga_estrutura');
    expect(mensagens(await acaoImportarCentrosCusto(await formulario({ data: '0000-01-01', documento: 'Ata antiga' })))).toEqual([
      'aprovacao.data: A data da aprovação deve ser de 2000 em diante.',
    ]);
  });

  it('só a data, sem o documento: erro no documento, sem lote', async () => {
    expect(mensagens(await acaoImportarCentrosCusto(await formulario({ data: '2026-10-30', documento: '' })))).toEqual([
      'aprovacao.documento: Informe a referência do documento de aprovação (3 a 120 caracteres).',
    ]);
  });

  it('sem executar (orçamentista): 403 auditado', async () => {
    contexto = { ...gfin(), permissoes: permissoes(['cad.centros_custo', 'consultar']) };
    expect(await acaoImportarCentrosCusto(await formulario(APROVACAO))).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.centros_custo' })]);
  });
});

describe('acaoConsultarCargaCc', () => {
  it('avisos da R3 (gerência sem CC de gestão) aparecem no resultado do lote', async () => {
    // Tira o CC de gestão (analítico .0 no nível 3) da primeira gerência que tiver um.
    const gestao = MINUTA.find((l) => l['Nível'] === '3' && /anal/i.test(l['Tipo'] ?? '') && (l['Classificação'] ?? '').endsWith('.0'));
    if (!gestao) throw new Error('a minuta não tem CC de gestão de gerência');
    const r = await acaoImportarCentrosCusto(await formulario(APROVACAO, MINUTA.filter((l) => l !== gestao)));
    if (!r.ok) throw new Error(JSON.stringify(r.erros.slice(0, 3)));
    const r3 = (a: { mensagem: string }) => /centros de custo de gestão; o esperado é 1/.test(a.mensagem);
    expect(r.valor.avisos.filter(r3)).not.toEqual([]);

    await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
    const c = await acaoConsultarCargaCc({ cargaId: r.valor.cargaId });
    if (!c.ok || !c.valor) throw new Error('lote não encontrado');
    expect(c.valor.situacao).toBe('CONCLUIDA');
    expect(c.valor.avisos.filter(r3)).toEqual(r.valor.avisos.filter(r3));
  });

  it('a consulta exige cad.centros_custo:executar, não a do plano de contas', async () => {
    const r = await acaoImportarCentrosCusto(await formulario(APROVACAO));
    if (!r.ok) throw new Error('importação recusada');
    contexto = { ...gfin(), permissoes: permissoes(['cad.centros_custo', 'executar']) };
    expect(await acaoConsultarCargaCc({ cargaId: r.valor.cargaId })).toMatchObject({ ok: true, valor: { tipo: 'CENTROS_CUSTO' } });
    contexto = { ...gfin(), permissoes: permissoes(['cad.plano_contas', 'executar']) };
    expect(await acaoConsultarCargaCc({ cargaId: r.valor.cargaId })).toMatchObject({ ok: false, status: 403 });
  });

  it('M-n1: lote do plano de contas, mesmo com a permissão dele, volta null', async () => {
    const { rows } = await migrator.query(`INSERT INTO carga_estrutura (id, tipo, arquivo_nome, arquivo_sha256, linhas, contexto_auditoria)
      VALUES (gen_random_uuid(), 'PLANO_CONTAS', 'plano.xlsx', repeat('0', 64), 1, '{}'::jsonb) RETURNING id`);
    expect(await acaoConsultarCargaCc({ cargaId: rows[0].id })).toEqual({ ok: true, valor: null });
  });
});
