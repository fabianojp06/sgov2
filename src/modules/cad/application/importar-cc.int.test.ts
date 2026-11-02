import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_CENTROS_CUSTO } from '../domain/centros-custo';
import minuta from '../infrastructure/dados/cc-minuta-rev23102026.json';
import { carregarIndiceEstrutura, ehCentroCustoAnalitico, listarArvoreCentrosCusto } from '../infrastructure/estrutura-financeira';
import { iniciarProcessadorCargas } from '../infrastructure/processador-cargas';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { cargaProvisoriaPermitida, consultarCarga, solicitarCargaCentrosCusto, type AprovacaoDirex } from './importar-estrutura';

// US-046 parte 1 (plano do P4, Task 5, Step 2): centros de custo, com Postgres real.
type Celulas = Record<(typeof COLUNAS_CENTROS_CUSTO)[number], string | null>;
const MINUTA = (minuta as { numero: number; celulas: Celulas }[]).map((l) => l.celulas);
const APROVACAO: AprovacaoDirex = { data: '2026-10-30', documento: 'Ata DIREX 12/2026' };

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let sync: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;

const ctx = (): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'GFIN',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(['cad.centros_custo:consultar', 'cad.centros_custo:executar']),
});

// Layout da minuta: títulos nas 3 primeiras linhas e o cabeçalho na 4ª.
async function xlsx(linhas: readonly Celulas[]): Promise<{ nome: string; conteudo: Uint8Array }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plano de Centros de Custo');
  ws.addRow(['Plano de Centros de Custo (minuta)']);
  ws.addRow(['Rev23102026']);
  ws.addRow([]);
  ws.addRow([...COLUNAS_CENTROS_CUSTO]);
  for (const l of linhas) ws.addRow(COLUNAS_CENTROS_CUSTO.map((c) => l[c]));
  return { nome: 'cc.xlsx', conteudo: new Uint8Array(await wb.xlsx.writeBuffer()) };
}

const processador = () => iniciarProcessadorCargas({ clienteSync: sync, automatico: false });

async function carregar(linhas: readonly Celulas[] = MINUTA, aprovacao: AprovacaoDirex | null = APROVACAO, provisoria = false) {
  const r = await solicitarCargaCentrosCusto(ctx(), await xlsx(linhas), aprovacao, { cliente: app, cargaProvisoriaPermitida: provisoria });
  if (!r.ok) throw new Error(`solicitação recusada: ${JSON.stringify(r.erros.slice(0, 3))}`);
  return r.valor.cargaId;
}
const estado = async (id: string) => (await consultarCarga(ctx(), id, { cliente: app }))!;

async function zerar(): Promise<void> {
  await migrator.query('BEGIN');
  for (let nivel = 5; nivel >= 1; nivel--) await migrator.query('DELETE FROM centro_custo WHERE nivel = $1', [nivel]);
  await migrator.query(`DELETE FROM carga_estrutura WHERE tipo = 'CENTROS_CUSTO'`);
  await migrator.query('COMMIT');
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('GFIN', 'gfin@exemplo.org', 'gfin', 'gfin', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), sync?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

beforeEach(async () => {
  await zerar();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('carga dos centros de custo', () => {
  it('com aprovação: provisorio = false, com a data e o documento no lote e no Histórico', async () => {
    const id = await carregar();
    await processador().executarCiclo();
    expect(await estado(id)).toMatchObject({ situacao: 'CONCLUIDA', incluidas: 35 });
    expect(await sync.centroCusto.count({ where: { provisorio: false } })).toBe(35);
    const lote = (await migrator.query('SELECT provisoria, aprovacao_data::text AS data, aprovacao_documento AS doc FROM carga_estrutura WHERE id = $1', [id])).rows[0];
    expect(lote).toEqual({ provisoria: false, data: '2026-10-30', doc: 'Ata DIREX 12/2026' });
    const h = (await migrator.query(`SELECT depois FROM historico_operacao WHERE registro_id = $1`, [id])).rows[0];
    expect(h.depois.aprovacao).toEqual({ data: '2026-10-30', documento: 'Ata DIREX 12/2026' });
  });

  it('sem aprovação: sem carga provisória → erro em aprovacao; com ela → todos provisórios', async () => {
    const r = await solicitarCargaCentrosCusto(ctx(), await xlsx(MINUTA), null, { cliente: app, cargaProvisoriaPermitida: false });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'aprovacao', mensagem: expect.stringContaining('DIREX') }] });
    const id = await carregar(MINUTA, null, true);
    await processador().executarCiclo();
    expect((await estado(id)).situacao).toBe('CONCLUIDA');
    expect(await sync.centroCusto.count({ where: { provisorio: true } })).toBe(35);
  });

  it('aprovação inválida (data futura, documento curto) → erros nos campos', async () => {
    const r = await solicitarCargaCentrosCusto(ctx(), await xlsx(MINUTA), { data: '2999-01-01', documento: 'x' }, { cliente: app });
    expect(r.ok === false && r.erros.map((e) => e.campo)).toEqual(['aprovacao.data', 'aprovacao.documento']);
  });

  it('CC_CARGA_PROVISORIA: só vale com 1 e fora de produção (ignorada com log em produção)', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(cargaProvisoriaPermitida({ CC_CARGA_PROVISORIA: '1', AMBIENTE: 'hml' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(cargaProvisoriaPermitida({ CC_CARGA_PROVISORIA: 'true', AMBIENTE: 'hml' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(cargaProvisoriaPermitida({ CC_CARGA_PROVISORIA: '1', AMBIENTE: 'producao' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(aviso).toHaveBeenCalledWith('[CC_CARGA_PROVISORIA_IGNORADA] CC_CARGA_PROVISORIA não vale em produção');
  });

  it('R5: reduzido movido inativa o antigo, cria o novo e avisa; mesma classificação com outro tipo → erro na tela', async () => {
    await carregar();
    await processador().executarCiclo();
    const linhas = MINUTA.filter((l) => l['Classificação'] !== '4.3.2.13');
    linhas.push({ ...MINUTA.find((l) => l['Classificação'] === '4.3.2.13')!, Classificação: '4.3.2.14' });
    const id = await carregar(linhas);
    await processador().executarCiclo();
    const e = await estado(id);
    expect(e).toMatchObject({ situacao: 'CONCLUIDA', incluidas: 1, inativadas: 1 });
    expect(e.avisos).toEqual([expect.objectContaining({ mensagem: expect.stringContaining('4.3.2.13') })]);
    const outroTipo = MINUTA.map((l) => (l['Classificação'] === '4.4' ? { ...l, Tipo: 'Sintético', 'Aceita lançamento': 'N' } : l));
    // 4.4 sintético sem filho também é erro de validação; por isso, um filho novo dele.
    outroTipo.push({ ...MINUTA.find((l) => l['Classificação'] === '4.4')!, Classificação: '4.4.1', 'Código reduzido': '14.990', Nível: '3', 'Classificação pai': '4.4' });
    const r = await solicitarCargaCentrosCusto(ctx(), await xlsx(outroTipo), APROVACAO, { cliente: app });
    expect(r.ok === false && r.erros).toEqual([expect.objectContaining({ campo: expect.stringMatching(/^linhas\.\d+\.Tipo$/) })]);
  });

  it('idempotência, ausente inativado e segunda carga recusada', async () => {
    await carregar();
    await processador().executarCiclo();
    const id = await carregar();
    await processador().executarCiclo();
    expect(await estado(id)).toMatchObject({ incluidas: 0, alteradas: 0, inativadas: 0, inalteradas: 35 });
    const sem44 = MINUTA.filter((l) => l['Classificação'] !== '4.4');
    const id2 = await carregar(sem44);
    expect((await solicitarCargaCentrosCusto(ctx(), await xlsx(MINUTA), APROVACAO, { cliente: app })).ok).toBe(false);
    await processador().executarCiclo();
    expect(await estado(id2)).toMatchObject({ inativadas: 1 });
    expect(await ehCentroCustoAnalitico(app, '4.4')).toBe(false);
  });

  it('a carga só roda como sgo_sync', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar();
    await iniciarProcessadorCargas({ clienteSync: app, automatico: false }).executarCiclo();
    expect((await estado(id)).situacao).toBe('PENDENTE');
  });

  it('produção (S-N3): lote provisório, ou sem a DIREX, gravado direto → FALHOU', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar(MINUTA, null, true);
    vi.stubEnv('AMBIENTE', 'producao');
    await processador().executarCiclo();
    expect(await estado(id)).toMatchObject({ situacao: 'FALHOU', erros: [{ linha: 0, mensagem: expect.stringContaining('DIREX') }] });
    expect(await sync.centroCusto.count()).toBe(0);
  });

  it('linha de CC adulterada no staging → FALHOU com o erro na linha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar();
    await migrator.query(`UPDATE carga_estrutura_linha SET dados = jsonb_set(dados, '{deGestao}', 'true') WHERE carga_id = $1 AND numero = 6`, [id]);
    await processador().executarCiclo();
    expect((await estado(id)).erros).toEqual([{ linha: 6, mensagem: 'Linha adulterada no staging.' }]);
  });

  it('C1 real: 4.4 analítico, os 14 analíticos da DAF e o provisório na árvore', async () => {
    await carregar(MINUTA, null, true);
    await processador().executarCiclo();
    expect(await ehCentroCustoAnalitico(app, '4.4')).toBe(true);
    expect(await ehCentroCustoAnalitico(app, '4.3')).toBe(false);
    const indice = await carregarIndiceEstrutura(app);
    const daf = indice.centrosCustoAnaliticosSob('4.3');
    expect(daf).toHaveLength(14);
    expect(daf[0]).toBe('4.3.0');
    const arvore = await listarArvoreCentrosCusto(app);
    expect(arvore[0]).toMatchObject({ classificacao: '4', provisorio: true });
  });

  it('seed com CARGA_DADOS_REFERENCIA=1 → minuta provisória; não sobrescreve um plano aprovado', async () => {
    const m = criarPrisma(banco.urlMigrator);
    try {
      vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
      vi.stubEnv('AMBIENTE', 'dev');
      await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
      expect(await sync.centroCusto.count({ where: { provisorio: true, ativo: true } })).toBe(35);
      await migrator.query('UPDATE centro_custo SET provisorio = false');
      await executarSeeds(m, [seedDadosReferenciaCad]);
      expect(await sync.centroCusto.count({ where: { provisorio: true } })).toBe(0);
    } finally {
      await m.$disconnect();
    }
  });
});
