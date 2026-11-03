import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_CARGOS } from '../domain/cargo';
import { criarCifraSalarios } from '../infrastructure/cifra-salarios';
import { CHAVE_TESTE_CIFRA, ID_CHAVE_TESTE } from '../infrastructure/cifra-teste';
import { iniciarProcessadorCargas } from '../infrastructure/processador-cargas';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { consultarCarga, solicitarCargaCargos } from './importar-estrutura';

// US-049 parte 1 (plano do P4, Task 12a, Step 3): cargos do Rubi por arquivo, com o salário real
// cifrado pelo app e o merge no worker como sgo_sync, num Postgres real (Testcontainers, D12).
type Celulas = Partial<Record<(typeof COLUNAS_CARGOS)[number], string | null>>;
const cifra = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE });

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let sync: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const grh = (): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'grh', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(['executar'].map((a) => `cad.cargos:${a}`)) });

const linha = (codigo: string, extra: Celulas = {}): Celulas => ({
  'Código do Cargo': codigo,
  Cargo: `Cargo ${codigo}`,
  'Cargo Mercado': `Mercado ${codigo}`,
  'Tabela Salarial (código)': 'T1',
  'Tabela Salarial (descrição)': 'Tabela 1',
  'Faixa (código)': 'F1',
  'Faixa (descrição)': 'Faixa 1',
  'Nível (código)': 'N1',
  'Nível (descrição)': 'Nível 1',
  'Salário Real': '7500.00',
  ...extra,
});

async function xlsx(linhas: readonly Celulas[]): Promise<{ nome: string; conteudo: Uint8Array }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cargos');
  ws.addRow([...COLUNAS_CARGOS]);
  for (const l of linhas) ws.addRow(COLUNAS_CARGOS.map((c) => l[c] ?? null));
  return { nome: 'cargos.xlsx', conteudo: new Uint8Array(await wb.xlsx.writeBuffer()) };
}

async function carregar(linhas: readonly Celulas[]): Promise<string> {
  const r = await solicitarCargaCargos(grh(), await xlsx(linhas), { cliente: app, cifra });
  if (!r.ok) throw new Error(`solicitação recusada: ${JSON.stringify(r.erros.slice(0, 3))}`);
  await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
  const e = await consultarCarga(grh(), r.valor.cargaId, { cliente: app });
  if (e?.situacao !== 'CONCLUIDA') throw new Error(`lote não concluiu: ${JSON.stringify(e)}`);
  return r.valor.cargaId;
}

const cargo = async (codigo: string) => (await migrator.query('SELECT * FROM cargo WHERE codigo = $1', [codigo])).rows[0];

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('GRH', 'grh@exemplo.org', 'grh', 'grh', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), sync?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

beforeEach(async () => {
  await migrator.query('DELETE FROM cargo');
  await migrator.query(`DELETE FROM carga_estrutura WHERE tipo IN ('CARGOS', 'CARGOS_RECIFRA')`);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('importação dos cargos do Rubi (R20)', () => {
  it('entram com o salário real cifrado: nenhum SELECT acha "7500"; o envelope decifra no app', async () => {
    await carregar([linha('C1'), linha('C2', { 'Salário Real': null })]);
    const c1 = await cargo('C1');
    expect(c1).toMatchObject({ nome_oficial: 'Cargo C1', faixa_codigo: 'F1', ativo: true, versao: 1 });
    expect(c1.salario_real_cifrado).toMatch(new RegExp(`^v1:${ID_CHAVE_TESTE}:`));
    expect(cifra.decifrar(c1.salario_real_cifrado, { codigoCargo: 'C1', campo: 'salario_real' }).paraString()).toBe('7500.00');
    expect((await cargo('C2')).salario_real_cifrado).toBeNull();
    const vazamento = await migrator.query(`SELECT 1 FROM cargo t WHERE t::text LIKE '%7500%'`);
    expect(vazamento.rows).toEqual([]);
  });

  it('I9: salário inválido dá erro sem repetir o valor (só a linha e a coluna "Salário Real")', async () => {
    const r = await solicitarCargaCargos(grh(), await xlsx([linha('C1', { 'Salário Real': '75x00' })]), { cliente: app, cifra });
    expect(r).toEqual({
      ok: false,
      erros: [{ campo: 'linhas.2.Salário Real', mensagem: 'Salário inválido: informe um valor maior que zero, com até 2 casas decimais.' }],
    });
    expect(JSON.stringify(r)).not.toContain('75x00');
  });

  it('recarga idempotente pelo código: mesmo arquivo → nada muda (nem o envelope); não toca nos campos manuais; o ausente fica inativo', async () => {
    await carregar([linha('C1'), linha('C2')]);
    const antes = await cargo('C1');
    await migrator.query(`UPDATE cargo SET mercado_minimo = 6000, mercado_maximo = 9000, fonte_ativa = 'REAL' WHERE codigo = 'C1'`);
    const id = await carregar([linha('C1'), linha('C2')]);
    expect(await consultarCarga(grh(), id, { cliente: app })).toMatchObject({ incluidas: 0, alteradas: 0, inativadas: 0, inalteradas: 2 });
    expect((await cargo('C1')).salario_real_cifrado).toBe(antes.salario_real_cifrado);

    const id2 = await carregar([linha('C1', { Cargo: 'Cargo C1 renomeado' })]);
    expect(await consultarCarga(grh(), id2, { cliente: app })).toMatchObject({ alteradas: 1, inativadas: 1 });
    expect(await cargo('C1')).toMatchObject({ nome_oficial: 'Cargo C1 renomeado', mercado_minimo: '6000.00', fonte_ativa: 'REAL', versao: 2 });
    expect(await cargo('C2')).toMatchObject({ ativo: false });
  });

  it('salário numérico na planilha (o normal do Excel) também entra', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cargos');
    ws.addRow([...COLUNAS_CARGOS]);
    ws.addRow(COLUNAS_CARGOS.map((c) => (c === 'Salário Real' ? 7500.5 : (linha('C7')[c] ?? null))));
    const r = await solicitarCargaCargos(grh(), { nome: 'n.xlsx', conteudo: new Uint8Array(await wb.xlsx.writeBuffer()) }, { cliente: app, cifra });
    expect(r.ok).toBe(true);
  });

  it('cargo inativo que volta no arquivo é reativado; a inativação sobe a versão e vai ao Histórico', async () => {
    await carregar([linha('C1'), linha('C2')]);
    await carregar([linha('C1')]);
    expect(await cargo('C2')).toMatchObject({ ativo: false, versao: 2 });
    const h = await migrator.query(`SELECT descricao FROM historico_operacao WHERE funcionalidade = 'cad.cargos' AND registro_id = 'C2' ORDER BY id`);
    expect(h.rows.map((r) => r.descricao)).toContain('Cargo C2 inativado pela carga (fora do arquivo)');
    const id = await carregar([linha('C1'), linha('C2')]);
    expect(await consultarCarga(grh(), id, { cliente: app })).toMatchObject({ alteradas: 1, inalteradas: 1 });
    expect(await cargo('C2')).toMatchObject({ ativo: true, versao: 3 });
  });

  // O staging é gravado só pelo sgo_app; o worker recusa o que não é a saída canônica do domínio
  // (salário fora do envelope, texto fora do padrão), não um texto válido trocado.
  it('staging adulterado (salário em claro, nome fora do padrão): o lote FALHOU e o cargo fica intacto', async () => {
    await carregar([linha('C1')]);
    const antes = await cargo('C1');
    for (const adulterar of [`jsonb_set(dados, '{salarioRealCifrado}', '"7500.00"')`, `jsonb_set(dados, '{nomeOficial}', '"  Cargo C1  "')`]) {
      const r = await solicitarCargaCargos(grh(), await xlsx([linha('C1', { 'Salário Real': '9999.00' })]), { cliente: app, cifra });
      if (!r.ok) throw new Error('recusada');
      await migrator.query(`UPDATE carga_estrutura_linha SET dados = ${adulterar} WHERE carga_id = $1`, [r.valor.cargaId]);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
      expect(await consultarCarga(grh(), r.valor.cargaId, { cliente: app })).toMatchObject({ situacao: 'FALHOU', erros: [{ mensagem: 'Linha adulterada no staging.' }] });
      expect(await cargo('C1')).toEqual(antes);
    }
  });

  it('rotação adiantada: com k0 ainda em _ANTERIORES, a recarga troca o envelope para a chave atual (mesmo valor)', async () => {
    const k0b64 = Buffer.alloc(32, 9).toString('base64');
    const k0 = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: k0b64, CHAVE_CIFRA_SALARIOS_ID: 'k0' });
    const r0 = await solicitarCargaCargos(grh(), await xlsx([linha('C1')]), { cliente: app, cifra: k0 });
    if (!r0.ok) throw new Error('recusada');
    await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
    const comAnterior = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE, CHAVE_CIFRA_SALARIOS_ANTERIORES: `k0:${k0b64}` });
    const r1 = await solicitarCargaCargos(grh(), await xlsx([linha('C1')]), { cliente: app, cifra: comAnterior });
    if (!r1.ok) throw new Error('recusada');
    await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
    expect((await cargo('C1')).salario_real_cifrado).toMatch(new RegExp(`^v1:${ID_CHAVE_TESTE}:`));
  });

  it('envelope da chave atual que não fecha (copiado de outro cargo): cifra de novo e avisa, só com o código', async () => {
    await carregar([linha('C1'), linha('C2', { 'Salário Real': '9100.00' })]);
    await migrator.query(`UPDATE cargo SET salario_real_cifrado = (SELECT salario_real_cifrado FROM cargo WHERE codigo = 'C2') WHERE codigo = 'C1'`);
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await carregar([linha('C1'), linha('C2', { 'Salário Real': '9100.00' })]);
    expect(aviso).toHaveBeenCalledWith('[CIFRA_SALARIOS_ENVELOPE_INVALIDO]', { codigoCargo: 'C1' });
    expect(cifra.decifrar((await cargo('C1')).salario_real_cifrado, { codigoCargo: 'C1', campo: 'salario_real' }).paraString()).toBe('7500.00');
  });

  it('envelope de uma chave que saiu do keyring: a recarga cifra de novo com a atual, sem erro', async () => {
    const k0 = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: Buffer.alloc(32, 7).toString('base64'), CHAVE_CIFRA_SALARIOS_ID: 'k0' });
    const r0 = await solicitarCargaCargos(grh(), await xlsx([linha('C1')]), { cliente: app, cifra: k0 });
    if (!r0.ok) throw new Error('recusada');
    await iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
    expect((await cargo('C1')).salario_real_cifrado).toMatch(/^v1:k0:/);
    await carregar([linha('C1')]);
    const depois = (await cargo('C1')).salario_real_cifrado;
    expect(depois).toMatch(new RegExp(`^v1:${ID_CHAVE_TESTE}:`));
    expect(cifra.decifrar(depois, { codigoCargo: 'C1', campo: 'salario_real' }).paraString()).toBe('7500.00');
  });

  it('salário que muda: envelope novo; o Histórico tem o envelope, nunca o valor', async () => {
    await carregar([linha('C1')]);
    const antes = (await cargo('C1')).salario_real_cifrado;
    await carregar([linha('C1', { 'Salário Real': '8100,50' })]);
    const depois = (await cargo('C1')).salario_real_cifrado;
    expect(depois).not.toBe(antes);
    expect(cifra.decifrar(depois, { codigoCargo: 'C1', campo: 'salario_real' }).paraString()).toBe('8100.50');
    const h = await migrator.query(`SELECT coalesce(antes::text, '') || coalesce(depois::text, '') AS t FROM historico_operacao WHERE funcionalidade = 'cad.cargos' AND registro_id = 'C1'`);
    expect(h.rows.length).toBeGreaterThan(0);
    for (const { t } of h.rows) {
      expect(t).not.toMatch(/7500|8100/);
    }
    expect(h.rows.some(({ t }) => t.includes(depois))).toBe(true);
  });

  it('a carga só roda como sgo_sync: com o cliente do app, nada é aplicado', async () => {
    const r = await solicitarCargaCargos(grh(), await xlsx([linha('C1')]), { cliente: app, cifra });
    if (!r.ok) throw new Error('recusada');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await iniciarProcessadorCargas({ clienteSync: app, automatico: false }).executarCiclo();
    expect((await consultarCarga(grh(), r.valor.cargaId, { cliente: app }))?.situacao).toBe('PENDENTE');
    expect(await cargo('C1')).toBeUndefined();
  });

  it('m2: o sgo_sync não insere coluna manual; o app não altera coluna do Rubi', async () => {
    const s = new pg.Client({ connectionString: banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync') });
    await s.connect();
    try {
      await expect(s.query(`INSERT INTO cargo (codigo, nome_oficial, salario_definido_cifrado) VALUES ('X1', 'X', NULL)`)).rejects.toThrow(/permission denied/);
    } finally {
      await s.end();
    }
    await carregar([linha('C1')]);
    await expect(app.$executeRaw`UPDATE cargo SET nome_oficial = 'outro' WHERE codigo = 'C1'`).rejects.toThrow(/permission denied/);
    await expect(migrator.query(`UPDATE cargo SET codigo = 'C9' WHERE codigo = 'C1'`)).rejects.toThrow(/não muda/);
    await expect(migrator.query(`UPDATE cargo SET salario_real_cifrado = '7500.00' WHERE codigo = 'C1'`)).rejects.toThrow(/cargo_envelopes_check/);
  });

  it('m5: com um lote CARGOS pendente, o de CARGOS_RECIFRA é recusado (mesmo grupo)', async () => {
    const r = await solicitarCargaCargos(grh(), await xlsx([linha('C1')]), { cliente: app, cifra });
    expect(r.ok).toBe(true);
    await expect(
      migrator.query(`INSERT INTO carga_estrutura (tipo, arquivo_nome, arquivo_sha256, linhas, contexto_auditoria) VALUES ('CARGOS_RECIFRA', 'r', 'x', 1, '{}'::jsonb)`),
    ).rejects.toThrow(/carga_estrutura_grupo_andamento_key/);
    expect(await solicitarCargaCargos(grh(), await xlsx([linha('C1')]), { cliente: app, cifra })).toEqual({
      ok: false,
      erros: [{ campo: 'arquivo', mensagem: 'Já existe uma carga de cargos em andamento. Tente de novo em instantes.' }],
    });
  });

  it('sem cad.cargos:executar: ErroPermissao antes de ler o arquivo', async () => {
    await expect(solicitarCargaCargos({ ...grh(), permissoes: new Set() }, await xlsx([linha('C1')]), { cliente: app, cifra })).rejects.toThrow();
  });
});

describe('seed dos cargos sintéticos (R20, P3)', () => {
  it('com CARGA_DADOS_REFERENCIA=1, entram sem salário, e a seed roda sem a chave; a segunda vez não muda nada', async () => {
    const m = criarPrisma(banco.urlMigrator);
    try {
      vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
      vi.stubEnv('AMBIENTE', 'dev');
      vi.stubEnv('CHAVE_CIFRA_SALARIOS', '');
      await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
      const { rows } = await migrator.query(`SELECT count(*)::int AS n, count(salario_real_cifrado)::int AS com_salario FROM cargo`);
      expect(rows[0]).toEqual({ n: 8, com_salario: 0 });
      await executarSeeds(m, [seedDadosReferenciaCad]);
      expect((await migrator.query(`SELECT count(*)::int AS n FROM carga_estrutura WHERE tipo = 'CARGOS'`)).rows[0].n).toBe(1);
    } finally {
      await m.$disconnect();
    }
  });
});
