import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { CHAVE_TESTE_CIFRA, criarCifraSalarios, ID_CHAVE_TESTE, seedCad, seedDadosReferenciaCad } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { exportarConferenciaCarga, obterConferenciaCarga } from './conferencia-carga';
import type { LinhaConferencia } from './linhas-conferencia';

// Conferência da carga (plano do P7, Task 2; US-115) num Postgres real (Testcontainers, D12), com a
// seed de referência do cad (plano oficial, minuta de CC e cargos sintéticos).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
const cifra = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE });

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const gfin = () => ctx(['rel.conferencia_carga', 'consultar'], ['rel.conferencia_carga', 'exportar']);
const comSalarios = () => ctx(['rel.conferencia_carga', 'consultar'], ['rel.conferencia_carga', 'exportar'], ['cad.salarios', 'consultar']);
const valor = (linhas: readonly LinhaConferencia[], item: string) => linhas.find((l) => l.item === item);
const historico = async (funcionalidade: string, tipo: string) =>
  Number((await migrator.query(`SELECT count(*) FROM historico_operacao WHERE funcionalidade = $1 AND tipo_operacao = $2`, [funcionalidade, tipo])).rows[0].count);
const contar = async (sql: string) => Number((await migrator.query(sql)).rows[0].count);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad, seedRel]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
  usuarioId = rows[0].id;
  // Dois salários reais legíveis (5.000,00 + 2.500,50), um ilegível (AAD de outro cargo) e um inativo.
  const env = (codigo: string, v: string) => cifra.cifrar(Dinheiro.de(v), { codigoCargo: codigo, campo: 'salario_real' });
  await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado) VALUES ('CONF1', 'C1', $1), ('CONF2', 'C2', $2), ('CONF3', 'C3', $3)`, [
    env('CONF1', '5000.00'),
    env('CONF2', '2500.50'),
    env('CONF1', '1.00'),
  ]);
  await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado, ativo) VALUES ('CONF4', 'C4', $1, false)`, [env('CONF4', '9999.00')]);
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('conferência da carga (P7, Task 2)', () => {
  it('as contagens batem com o banco, por nível, e o exercício mais recente é o padrão', async () => {
    const t = await obterConferenciaCarga(gfin(), null, { cliente: app, cifra });
    expect(t.ano).toBe(2027);
    expect(t.anos).toContain(2027);
    const analiticas = await contar(`SELECT count(*) FROM conta_contabil WHERE ativa AND tipo = 'ANALITICA'`);
    expect(analiticas).toBeGreaterThan(0);
    expect(valor(t.linhas, 'Analíticas ativas')?.quantidade).toBe(String(analiticas));
    const nivel1 = await contar(`SELECT count(*) FROM conta_contabil WHERE ativa AND nivel = 1`);
    expect(valor(t.linhas.filter((l) => l.secao === 'Plano de contas'), 'Nível 1: ativas')?.quantidade).toBe(String(nivel1));
    const ccAnaliticos = await contar(`SELECT count(*) FROM centro_custo WHERE ativo AND aceita_lancamento`);
    expect(valor(t.linhas, 'Analíticos ativos')?.quantidade).toBe(String(ccAnaliticos));
    expect(valor(t.linhas, 'Ativos marcados como provisórios')?.quantidade).toBe(String(await contar(`SELECT count(*) FROM centro_custo WHERE ativo AND provisorio`)));
    expect(valor(t.linhas, 'Ativos')?.quantidade).toBe(String(await contar(`SELECT count(*) FROM cargo WHERE ativo`)));
    expect(valor(t.linhas, 'Inativos')?.quantidade).toBe(String(await contar(`SELECT count(*) FROM cargo WHERE NOT ativo`)));
    expect(valor(t.linhas, 'Encargos cadastrados')?.quantidade).toBe(String(await contar(`SELECT count(*) FROM encargo_exercicio WHERE ano = 2027`)));
  });

  it('sem cad.salarios: a soma fica oculta, nada é decifrado e não há consulta de salário no Histórico', async () => {
    const antes = await historico('cad.salarios', 'CONSULTA');
    const decifrar = vi.spyOn(cifra, 'decifrar');
    const t = await obterConferenciaCarga(gfin(), 2027, { cliente: app, cifra });
    const soma = valor(t.linhas, 'Soma dos salários reais dos cargos ativos');
    expect(soma).toMatchObject({ valor: null, oculto: true });
    expect(decifrar).not.toHaveBeenCalled();
    decifrar.mockRestore();
    expect(await historico('cad.salarios', 'CONSULTA')).toBe(antes);
    expect(valor(t.linhas, 'Salários reais ilegíveis (fora da soma)')).toBeUndefined();
  });

  it('com cad.salarios: soma só os cargos ativos legíveis, conta o ilegível à parte e registra a consulta', async () => {
    const antes = await historico('cad.salarios', 'CONSULTA');
    const t = await obterConferenciaCarga(comSalarios(), 2027, { cliente: app, cifra });
    expect(valor(t.linhas, 'Soma dos salários reais dos cargos ativos')).toMatchObject({ valor: '7500.50' });
    expect(valor(t.linhas, 'Soma dos salários reais dos cargos ativos')?.oculto).toBeUndefined();
    expect(valor(t.linhas, 'Salários reais ilegíveis (fora da soma)')?.quantidade).toBe('1');
    expect(await historico('cad.salarios', 'CONSULTA')).toBe(antes + 1);
  });

  it('sem a permissão de consultar: ErroPermissao', async () => {
    await expect(obterConferenciaCarga(ctx(['cad.cargos', 'consultar']), 2027, { cliente: app, cifra })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(exportarConferenciaCarga(ctx(['rel.conferencia_carga', 'consultar']), 2027, 'csv', { cliente: app, cifra })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('exporta CSV e XLSX com as mesmas linhas da tela e registra a exportação no Histórico', async () => {
    const antes = await historico('rel.conferencia_carga', 'EXPORTACAO');
    const tela = await obterConferenciaCarga(gfin(), 2027, { cliente: app, cifra });
    const csv = await exportarConferenciaCarga(gfin(), 2027, 'csv', { cliente: app, cifra });
    if (!csv.ok) throw new Error(JSON.stringify(csv.erros));
    expect(csv.valor).toMatchObject({ nome: 'conferencia-carga-2027.csv', tipo: 'text/csv; charset=utf-8' });
    const texto = new TextDecoder().decode(csv.valor.bytes);
    expect(texto.split('\r\n').filter(Boolean)).toHaveLength(tela.linhas.length + 1);
    expect(texto).toContain('"Soma dos salários reais dos cargos ativos (oculto: sem permissão de consultar salários)"');

    const xlsx = await exportarConferenciaCarga(comSalarios(), 2027, 'xlsx', { cliente: app, cifra });
    if (!xlsx.ok) throw new Error(JSON.stringify(xlsx.erros));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsx.valor.bytes) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Conferência 2027')!;
    const linha = ws.getRows(2, ws.rowCount - 1)!.find((r) => r.getCell(2).value === 'Soma dos salários reais dos cargos ativos');
    expect(linha?.getCell(4).value).toBe(7500.5);
    expect(await historico('rel.conferencia_carga', 'EXPORTACAO')).toBe(antes + 2);
  });

  it('exercício fora do intervalo: recusa sem exportar nem registrar', async () => {
    const antes = await historico('rel.conferencia_carga', 'EXPORTACAO');
    const r = await exportarConferenciaCarga(gfin(), 1999, 'csv', { cliente: app, cifra });
    expect(r.ok).toBe(false);
    expect(await historico('rel.conferencia_carga', 'EXPORTACAO')).toBe(antes);
  });
});
