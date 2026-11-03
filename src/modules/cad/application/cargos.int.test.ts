import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_CARGOS } from '../domain/cargo';
import { criarCifraSalarios } from '../infrastructure/cifra-salarios';
import { iniciarProcessadorCargas } from '../infrastructure/processador-cargas';
import { seedCad } from '../infrastructure/seed';
import { alterarCargo, listarCargos, obterCargo, regravarCifraSalarios, type EntradaCargo } from './cargos';
import { solicitarCargaCargos } from './importar-estrutura';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { acaoAlterarCargo } = await import('./acoes-cargos');

// US-049 parte 2 (plano do P4, Task 12b, Step 1): máscara por permissão (R24), alteração dos manuais
// e regravação da cifra (I7), num Postgres real (Testcontainers, D12).
const K0 = Buffer.alloc(32, 3).toString('base64');
const K1 = Buffer.alloc(32, 4).toString('base64');
const cifraK0 = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: K0, CHAVE_CIFRA_SALARIOS_ID: 'k0' });
const cifraK1 = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: K1, CHAVE_CIFRA_SALARIOS_ID: 'k1', CHAVE_CIFRA_SALARIOS_ANTERIORES: `k0:${K0}` });

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let sync: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'u',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)),
});
const grh = () => ctx(['cad.cargos', 'consultar'], ['cad.cargos', 'alterar'], ['cad.cargos', 'executar'], ['cad.salarios', 'consultar']);
const orcamentista = () => ctx(['cad.cargos', 'consultar'], ['cad.cargos', 'exportar']);
const auditor = () => ctx(['cad.cargos', 'consultar']);

async function xlsx(linhas: { codigo: string; salario: string | null }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cargos');
  ws.addRow([...COLUNAS_CARGOS]);
  for (const l of linhas) ws.addRow([l.codigo, `Cargo ${l.codigo}`, null, 'T1', 'Tabela 1', 'F1', 'Faixa 1', 'N1', 'Nível 1', l.salario]);
  return { nome: 'c.xlsx', conteudo: new Uint8Array(await wb.xlsx.writeBuffer()) };
}
const processar = () => iniciarProcessadorCargas({ clienteSync: sync, automatico: false }).executarCiclo();
async function carregar(linhas: { codigo: string; salario: string | null }[], cifra = cifraK1) {
  const r = await solicitarCargaCargos(grh(), await xlsx(linhas), { cliente: app, cifra });
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  await processar();
}
const idDe = async (codigo: string) => (await migrator.query('SELECT id FROM cargo WHERE codigo = $1', [codigo])).rows[0].id as string;
const versao = async (codigo: string) => (await migrator.query('SELECT versao FROM cargo WHERE codigo = $1', [codigo])).rows[0].versao as number;
const historicos = async () => Number((await migrator.query('SELECT count(*) AS n FROM historico_operacao')).rows[0].n);
const entrada = (x: Partial<EntradaCargo> = {}): EntradaCargo => ({
  mercadoMinimo: '6000',
  mercadoMaximo: '9000',
  periculosidade: false,
  insalubridade: null,
  fonteAtiva: 'TOTAL',
  funcaoGratificada: '1200',
  salarioDefinido: null,
  ...x,
});

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  global_.__sgoPrisma = app;
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GRH', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
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
  await migrator.query('DELETE FROM cargo');
  await migrator.query(`DELETE FROM carga_estrutura WHERE tipo IN ('CARGOS', 'CARGOS_RECIFRA')`);
  await migrator.query('UPDATE parametros_exercicio SET salario_minimo = 1518');
  contexto = grh();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
  vi.restoreAllMocks();
});

describe('máscara dos salários (R24)', () => {
  it('orçamentista: mascarado, salários e desvio nulos, sem CONSULTA; GRH: os valores e um CONSULTA sem valores', async () => {
    await carregar([{ codigo: 'C1', salario: '7500.00' }]);
    expect((await alterarCargo(grh(), await idDe('C1'), 1, entrada(), { cliente: app, cifra: cifraK1 })).ok).toBe(true);
    const antes = await historicos();
    const [mascarado] = await listarCargos(orcamentista(), { cliente: app });
    expect(mascarado).toMatchObject({ mascarado: true, desvioDeMercado: null, salarioDaFonte: null, salarios: { minimo: null, maximo: null, funcaoGratificada: null, real: null, definido: null } });
    expect(JSON.stringify(mascarado)).not.toMatch(/7500|6000|9000|1200/);
    expect(await historicos()).toBe(antes);

    const [aberto] = await listarCargos(grh(), { cliente: app, cifra: cifraK1 });
    expect(aberto).toMatchObject({ mascarado: false, salarioDaFonte: '10200.00', desvioDeMercado: 'DENTRO', salarios: { real: '7500.00', minimo: '6000.00' } });
    const c = await obterCargo(grh(), await idDe('C1'), { cliente: app, cifra: cifraK1 });
    expect(c?.salarios.funcaoGratificada).toBe('1200.00');
    const h = await migrator.query(`SELECT registro_id, tipo_operacao::text AS tipo, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.salarios' ORDER BY id`);
    expect(h.rows).toEqual([
      { registro_id: '*', tipo: 'CONSULTA', antes: null, depois: null },
      { registro_id: 'C1', tipo: 'CONSULTA', antes: null, depois: null },
    ]);
  });
});

describe('alterarCargo', () => {
  it('grava os manuais cifrados; FG igual não regrava o envelope; o Histórico leva só envelopes', async () => {
    await carregar([{ codigo: 'C1', salario: '7500.00' }]);
    const id = await idDe('C1');
    expect(await alterarCargo(grh(), id, 1, entrada(), { cliente: app, cifra: cifraK1 })).toEqual({ ok: true, valor: { versao: 2 } });
    const um = (await migrator.query(`SELECT funcao_gratificada_cifrada AS fg, origem_mercado_rotulo AS rotulo FROM cargo WHERE id = $1`, [id])).rows[0];
    expect(um.fg).toMatch(/^v1:k1:/);
    expect(um.rotulo).toBe('Editado manualmente');
    await alterarCargo(grh(), id, 2, entrada({ fonteAtiva: 'REAL' }), { cliente: app, cifra: cifraK1 });
    expect((await migrator.query(`SELECT funcao_gratificada_cifrada AS fg FROM cargo WHERE id = $1`, [id])).rows[0].fg).toBe(um.fg);
    const h = await migrator.query(`SELECT coalesce(antes::text, '') || coalesce(depois::text, '') AS t FROM historico_operacao WHERE funcionalidade = 'cad.cargos' AND tipo_operacao = 'ALTERACAO'`);
    for (const { t } of h.rows) expect(t).not.toMatch(/1200|7500/);
  });

  it('E6: insalubridade sem SMN → erro em adicional; E5 pela tela; versão velha → concorrência', async () => {
    await carregar([{ codigo: 'C1', salario: null }]);
    const id = await idDe('C1');
    await migrator.query('UPDATE parametros_exercicio SET salario_minimo = NULL');
    expect(await alterarCargo(grh(), id, 1, entrada({ insalubridade: 'MEDIO' }), { cliente: app, cifra: cifraK1 })).toEqual({
      ok: false,
      erros: [{ campo: 'adicional', mensagem: 'Cadastre o Salário Mínimo Nacional do exercício antes de usar insalubridade.' }],
    });
    expect((await alterarCargo(grh(), id, 1, entrada({ insalubridade: 'MEDIO', periculosidade: true }), { cliente: app, cifra: cifraK1 })).ok).toBe(false);
    expect(await alterarCargo(grh(), id, 7, entrada(), { cliente: app, cifra: cifraK1 })).toMatchObject({
      ok: false,
      erros: [{ mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    expect(await versao('C1')).toBe(1);
  });

  it('sem cad.salarios, não altera (os campos são sensíveis); com a auditoria falhando, nada é gravado', async () => {
    await carregar([{ codigo: 'C1', salario: null }]);
    const id = await idDe('C1');
    const semSalarios = ctx(['cad.cargos', 'consultar'], ['cad.cargos', 'alterar']);
    expect((await alterarCargo(semSalarios, id, 1, entrada(), { cliente: app, cifra: cifraK1 })).ok).toBe(false);
    await migrator.query('REVOKE INSERT ON historico_operacao FROM sgo_app');
    try {
      await expect(alterarCargo(grh(), id, 1, entrada(), { cliente: app, cifra: cifraK1 })).rejects.toThrow(/permission denied/);
    } finally {
      await migrator.query(`GRANT INSERT ("unidade_id", "usuario_id", "usuario_rotulo", "sessao_uid", "ip", "funcionalidade",
        "tipo_operacao", "registro_id", "descricao", "antes", "depois", "delta", "origem") ON historico_operacao TO sgo_app`);
    }
    expect(await versao('C1')).toBe(1);
  });
});

describe('acaoAlterarCargo', () => {
  it('ORIGEM BLINDADA: salarioReal ou nomeOficial no pedido → recusado e auditado, nada gravado (M4)', async () => {
    await carregar([{ codigo: 'C1', salario: null }]);
    const idCargo = await idDe('C1');
    for (const extra of [{ salarioReal: '1' }, { nomeOficial: 'Outro' }]) {
      const antes = await historicos();
      expect(await acaoAlterarCargo({ idCargo, versao: 1, ...entrada(), ...extra })).toMatchObject({
        ok: false,
        erros: [{ mensagem: 'O pedido tem campos que não podem ser alterados pela tela.' }],
      });
      expect(await historicos()).toBe(antes + 1);
    }
    expect(await versao('C1')).toBe(1);
  });

  it('escrita sem permissão (auditor): 403 auditado', async () => {
    await carregar([{ codigo: 'C1', salario: null }]);
    contexto = auditor();
    expect(await acaoAlterarCargo({ idCargo: await idDe('C1'), versao: 1, ...entrada() })).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.cargos' })]);
  });
});

describe('regravarCifraSalarios (I7)', () => {
  it('k0 → k1: os manuais direto, o salário real pelo lote CARGOS_RECIFRA no worker; depois, nenhum envelope com :k0:', async () => {
    await carregar([{ codigo: 'C1', salario: '7500.00' }, { codigo: 'C2', salario: '8000.00' }], cifraK0);
    await alterarCargo(grh(), await idDe('C1'), 1, entrada(), { cliente: app, cifra: cifraK0 });
    const r = await regravarCifraSalarios(grh(), { cliente: app, cifra: cifraK1 });
    expect(r).toMatchObject({ ok: true, valor: { manuais: 1 } });
    expect(r.ok && r.valor.cargaId).toBeTruthy();
    await processar();
    const k0 = await migrator.query(
      `SELECT count(*)::int AS n FROM cargo WHERE 'k0' IN (split_part(salario_real_cifrado, ':', 2), split_part(funcao_gratificada_cifrada, ':', 2), split_part(salario_definido_cifrado, ':', 2))`,
    );
    expect(k0.rows[0].n).toBe(0);
    const [c1] = await listarCargos(grh(), { cliente: app, cifra: cifraK1 });
    expect(c1?.salarios).toMatchObject({ real: '7500.00', funcaoGratificada: '1200.00' });
  });

  it('cargo cujo salário real mudou entre o pedido e o worker não é sobrescrito pela regravação', async () => {
    await carregar([{ codigo: 'C1', salario: '7500.00' }], cifraK0);
    const r = await regravarCifraSalarios(grh(), { cliente: app, cifra: cifraK1 });
    if (!r.ok) throw new Error('recusada');
    // No meio: outro valor gravado direto (como se uma carga tivesse entrado antes do worker).
    const novo = cifraK1.cifrar((await import('@/shared/kernel')).Dinheiro.de('9999.00'), { codigoCargo: 'C1', campo: 'salario_real' });
    await migrator.query(`UPDATE cargo SET salario_real_cifrado = $1 WHERE codigo = 'C1'`, [novo]);
    await processar();
    expect((await migrator.query(`SELECT salario_real_cifrado AS s FROM cargo WHERE codigo = 'C1'`)).rows[0].s).toBe(novo);
  });
});
