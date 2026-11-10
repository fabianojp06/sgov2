import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import ccMinuta from '../infrastructure/dados/cc-minuta-rev23102026.json';
import planoOficial from '../infrastructure/dados/plano-contas-oficial.json';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { exportarCentrosCusto, exportarPlanoContas } from './exportar-estrutura';

// Exportação das listagens do plano de contas e dos CCs (US-024 parte 2) num Postgres real
// (Testcontainers, D12), sobre a seed de referência: o cabeçalho (RN0011, RN_WATERMARK), as linhas
// da árvore e o Histórico com os registros, os filtros e o mesmo rastreio do arquivo.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const gfin = () => ctx(['cad.plano_contas', 'exportar'], ['cad.centros_custo', 'exportar']);
const ultimaExportacao = async (funcionalidade: string) =>
  (await migrator.query(`SELECT registro_id, depois FROM historico_operacao WHERE funcionalidade = $1 AND tipo_operacao = 'EXPORTACAO' ORDER BY id DESC LIMIT 1`, [funcionalidade])).rows[0];
const linhasCsv = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').split('\r\n');

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  usuarioId = (await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`)).rows[0].id;
  // Uma conta analítica inativada, fixa: "Treinamento de pessoal" (4.1.1.6.011), que casa com a busca
  // "pessoal" por conta própria; a 4.1.1.6 tem outras 30 filhas ativas.
  await migrator.query(`UPDATE conta_contabil SET ativa = false, inativada_em = now() WHERE classificacao = '4.1.1.6.011'`);
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('exportação do plano de contas e dos CCs (US-024)', () => {
  it('plano de contas em CSV: cabeçalho, as ativas na ordem da árvore e o Histórico com o rastreio', async () => {
    const r = await exportarPlanoContas(gfin(), { formato: 'csv', incluirInativos: false }, { cliente: app });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    const l = linhasCsv(r.valor);
    expect(l.slice(0, 2)).toEqual(['"Plano de contas"', '"Filtros: Inativos: não incluídos"']);
    const rastreio = /^"Rastreio: ([0-9a-f-]{36})"$/.exec(l[3]!)![1]!;
    expect(l[5]).toBe('"Classificação";"Reduzido";"Descrição";"Nível";"Tipo";"Situação"');
    const dados = l.slice(6).filter(Boolean);
    expect(dados).toHaveLength(planoOficial.length - 1);
    expect(dados[0]).toMatch(/^"4";"";"[^"]+";"1";"Sintética";"Ativa"$/);
    // A ordem inteira é a pré-ordem da árvore: cada conta logo depois da conta superior, irmãs pela
    // classificação em segmentos numéricos (a mesma ordem da tela).
    const classificacoes = dados.map((d) => d.split(';')[0]!.replace(/"/g, ''));
    const segmentos = (c: string) => c.split('.').map(Number);
    const esperada = [...classificacoes].sort((a, b) => {
      const [x, y] = [segmentos(a), segmentos(b)];
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return x.length - y.length;
    });
    expect(classificacoes).toEqual(esperada);
    expect(dados.every((d) => d.endsWith('"Ativa"'))).toBe(true);
    expect(await ultimaExportacao('cad.plano_contas')).toEqual({
      registro_id: rastreio,
      depois: { formato: 'csv', registros: planoOficial.length - 1, filtros: [{ rotulo: 'Inativos', valor: 'não incluídos' }], rastreio },
    });
  });

  it('plano de contas com os inativos: a conta inativada aparece como Inativa', async () => {
    const r = await exportarPlanoContas(gfin(), { formato: 'csv', incluirInativos: true }, { cliente: app });
    if (!r.ok) throw new Error('falhou');
    const dados = linhasCsv(r.valor).slice(6).filter(Boolean);
    expect(dados).toHaveLength(planoOficial.length);
    expect(dados.filter((d) => d.endsWith('"Inativa"'))).toHaveLength(1);
    expect((await ultimaExportacao('cad.plano_contas')).depois.filtros).toEqual([{ rotulo: 'Inativos', valor: 'incluídos' }]);
  });

  it('centros de custo em XLSX: cabeçalho, rodapé com o operador e as linhas da minuta', async () => {
    const r = await exportarCentrosCusto(gfin(), { formato: 'xlsx', incluirInativos: false }, { cliente: app });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(r.valor) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Centros de custo')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Centros de custo');
    // As colunas da tela (com os selos de gestão e de provisório numa coluna só).
    expect(ws.getRow(6).values).toEqual([undefined, 'Classificação', 'Reduzido', 'Descrição', 'Nível', 'Tipo', 'Selos', 'Situação']);
    expect(ws.rowCount).toBe(6 + ccMinuta.length);
    expect(ws.headerFooter.oddFooter).toMatch(/^&Lgfin&RRastreio [0-9a-f-]{36}$/);
    const rastreio = /^&Lgfin&RRastreio ([0-9a-f-]{36})$/.exec(ws.headerFooter.oddFooter!)![1];
    expect(await ultimaExportacao('cad.centros_custo')).toEqual({
      registro_id: rastreio,
      depois: { formato: 'xlsx', registros: ccMinuta.length, filtros: [{ rotulo: 'Inativos', valor: 'não incluídos' }], rastreio },
    });
  });

  // A regra da grade (aplicarFiltros, M5 do #222): quem casa pela busca leva a subárvore, que passa pelo
  // tipo; os ancestrais ficam como caminho. "pessoal" casa com a sintética "DESPESAS DE PESSOAL"
  // (4.1.1.1, as 25 analíticas abaixo dela entram por herança) e com a analítica 4.1.1.6.011, inativa.
  const contas = (planoOficial as { celulas: Record<string, string | null> }[]).map((l) => l.celulas);
  const debaixoDePessoal = contas.filter((c) => c['Classificação']!.startsWith('4.1.1.1.') && c['Tipo'] === 'A').map((c) => c['Classificação']!);
  const classificacoesDe = (bytes: Uint8Array) => linhasCsv(bytes).slice(6).filter(Boolean).map((d) => d.split(';')[0]!.replace(/"/g, ''));

  it('busca "pessoal" com tipo Analítica: a subárvore inteira, os caminhos, e os filtros no cabeçalho e no Histórico', async () => {
    const r = await exportarPlanoContas(gfin(), { formato: 'csv', incluirInativos: false, filtros: { busca: 'pessoal', tipo: 'Analítica', outro: 'ignorado' } }, { cliente: app });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(linhasCsv(r.valor)[1]).toBe('"Filtros: Inativos: não incluídos; Buscar por classificação, reduzido ou descrição: pessoal; Tipo: Analítica"');
    // Sem os inativos, a 4.1.1.6.011 sai e, com ela, o caminho 4.1.1.6: "mostrar inativos" vem antes do
    // filtro, como na tela (com a ordem invertida, a 4.1.1.6 ficaria sem filhas no arquivo).
    const classificacoes = classificacoesDe(r.valor);
    expect(classificacoes).toEqual(['4', '4.1', '4.1.1', '4.1.1.1', ...debaixoDePessoal]);
    expect((await ultimaExportacao('cad.plano_contas')).depois).toMatchObject({
      registros: classificacoes.length,
      filtros: [
        { rotulo: 'Inativos', valor: 'não incluídos' },
        { rotulo: 'Buscar por classificação, reduzido ou descrição', valor: 'pessoal' },
        { rotulo: 'Tipo', valor: 'Analítica' },
      ],
    });
  });

  it('a mesma busca com os inativos: entram a 4.1.1.6.011 e o caminho 4.1.1.6', async () => {
    const r = await exportarPlanoContas(gfin(), { formato: 'csv', incluirInativos: true, filtros: { busca: 'pessoal', tipo: 'Analítica' } }, { cliente: app });
    if (!r.ok) throw new Error('falhou');
    expect(classificacoesDe(r.valor)).toEqual(['4', '4.1', '4.1.1', '4.1.1.1', ...debaixoDePessoal, '4.1.1.6', '4.1.1.6.011']);
  });

  it('filtro com valor inválido: recusado antes de gerar, sem Histórico', async () => {
    const antes = await ultimaExportacao('cad.plano_contas');
    const r = await exportarPlanoContas(gfin(), { formato: 'csv', incluirInativos: false, filtros: { tipo: 'Qualquer' } }, { cliente: app });
    expect(!r.ok && r.erros.map((e) => e.campo)).toEqual(['tipo']);
    expect(await ultimaExportacao('cad.plano_contas')).toEqual(antes);
  });

  it('sem a permissão de exportar: ErroPermissao, sem arquivo nem Histórico', async () => {
    const antes = Number((await migrator.query(`SELECT count(*) FROM historico_operacao WHERE tipo_operacao = 'EXPORTACAO'`)).rows[0].count);
    await expect(exportarPlanoContas(ctx(['cad.plano_contas', 'consultar']), { formato: 'csv', incluirInativos: false }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(exportarCentrosCusto(ctx(['cad.plano_contas', 'exportar']), { formato: 'csv', incluirInativos: false }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    expect(Number((await migrator.query(`SELECT count(*) FROM historico_operacao WHERE tipo_operacao = 'EXPORTACAO'`)).rows[0].count)).toBe(antes);
  });

  it('falha na geração (operador vazio): nada vai para o Histórico', async () => {
    const antes = await ultimaExportacao('cad.plano_contas');
    const r = await exportarPlanoContas({ ...gfin(), usuarioRotulo: '' }, { formato: 'xlsx', incluirInativos: false }, { cliente: app });
    expect(!r.ok && r.erros.map((e) => e.campo)).toEqual(['planilhas.0.identificacao.operador']);
    expect(await ultimaExportacao('cad.plano_contas')).toEqual(antes);
  });
});
