import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { seedCad, seedDadosReferenciaCad } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { exportarConferenciaCarga, obterConferenciaCarga } from './conferencia-carga';
import type { LinhaConferencia } from './linhas-conferencia';

// Conferência da carga (plano do P7, Task 2; US-115) num Postgres real (Testcontainers, D12), com a
// seed de referência do cad. As contagens e a soma dos salários são testadas no cad
// (conferencia-cadastros.int.test.ts); aqui, a tela, a exportação, a permissão e o Histórico. Sem
// CHAVE_CIFRA_SALARIOS no ambiente do teste: com cad.salarios, a soma sai indisponível.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const gfin = () => ctx(['rel.conferencia_carga', 'consultar'], ['rel.conferencia_carga', 'exportar']);
const comSalarios = () => ctx(['rel.conferencia_carga', 'consultar'], ['rel.conferencia_carga', 'exportar'], ['cad.salarios', 'consultar']);
const linha = (linhas: readonly LinhaConferencia[], item: string) => linhas.find((l) => l.item === item);
const SOMA = 'Soma dos salários reais dos cargos ativos';
const historico = async (funcionalidade: string, tipo: string) =>
  Number((await migrator.query(`SELECT count(*) FROM historico_operacao WHERE funcionalidade = $1 AND tipo_operacao = $2`, [funcionalidade, tipo])).rows[0].count);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad, seedRel]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  vi.stubEnv('CHAVE_CIFRA_SALARIOS', '');
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  usuarioId = (await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`)).rows[0].id;
  await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado) VALUES ('CONF1', 'C1', $1)`, [
    // Envelope no formato do CHECK (cargo_envelopes_check); o conteúdo não importa sem a chave.
    `v1:teste1:${'A'.repeat(16)}:${'B'.repeat(22)}:C`,
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('conferência da carga (P7, Task 2)', () => {
  it('tela: o exercício mais recente por padrão, as seções do resumo e a soma oculta sem cad.salarios', async () => {
    const t = await obterConferenciaCarga(gfin(), null, { cliente: app });
    expect(t.ano).toBe(2027);
    expect(t.anos).toContain(2027);
    expect(new Set(t.linhas.map((l) => l.secao))).toEqual(new Set(['Plano de contas', 'Centros de custo', 'Cargos', 'Tabela salarial', 'Exercício 2027']));
    expect(linha(t.linhas, 'Analíticas ativas')?.quantidade).toBe('162');
    expect(linha(t.linhas, SOMA)).toMatchObject({ valor: null, oculto: 'oculta' });
  });

  it('com cad.salarios e sem a chave de cifra: a soma aparece como indisponível, sem consulta no Histórico', async () => {
    const antes = await historico('cad.salarios', 'CONSULTA');
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = await obterConferenciaCarga(comSalarios(), 2027, { cliente: app });
    erro.mockRestore();
    expect(linha(t.linhas, SOMA)).toMatchObject({ valor: null, oculto: 'indisponivel' });
    expect(await historico('cad.salarios', 'CONSULTA')).toBe(antes);
  });

  it('sem a permissão: ErroPermissao na tela e na exportação', async () => {
    await expect(obterConferenciaCarga(ctx(['cad.cargos', 'consultar']), 2027, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(exportarConferenciaCarga(ctx(['rel.conferencia_carga', 'consultar']), 2027, 'csv', { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('exporta CSV e XLSX com as linhas da tela e registra cada exportação no Histórico', async () => {
    const antes = await historico('rel.conferencia_carga', 'EXPORTACAO');
    const tela = await obterConferenciaCarga(gfin(), 2027, { cliente: app });
    const csv = await exportarConferenciaCarga(gfin(), 2027, 'csv', { cliente: app });
    if (!csv.ok) throw new Error(JSON.stringify(csv.erros));
    expect(csv.valor).toMatchObject({ nome: 'conferencia-carga-2027.csv', tipo: 'text/csv; charset=utf-8' });
    const texto = new TextDecoder().decode(csv.valor.bytes);
    expect(texto.split('\r\n').filter(Boolean)).toHaveLength(tela.linhas.length + 1);
    expect(texto).toContain(`"${SOMA} (oculto: sem permissão de consultar salários)"`);
    expect(texto).toContain('"Analíticas ativas";"162"');

    const xlsx = await exportarConferenciaCarga(gfin(), 2027, 'xlsx', { cliente: app });
    if (!xlsx.ok) throw new Error(JSON.stringify(xlsx.erros));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsx.valor.bytes) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Conferência 2027')!;
    expect(ws.rowCount).toBe(tela.linhas.length + 1);
    expect(ws.getRows(2, ws.rowCount - 1)!.some((r) => r.getCell(2).value === 'Analíticas ativas' && r.getCell(3).value === '162')).toBe(true);
    expect(await historico('rel.conferencia_carga', 'EXPORTACAO')).toBe(antes + 2);
  });

  it('exercício fora do intervalo: recusa sem exportar nem registrar', async () => {
    const antes = await historico('rel.conferencia_carga', 'EXPORTACAO');
    const r = await exportarConferenciaCarga(gfin(), 1999, 'csv', { cliente: app });
    expect(r.ok).toBe(false);
    expect(await historico('rel.conferencia_carga', 'EXPORTACAO')).toBe(antes);
  });
});
