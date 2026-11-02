import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { obterTelaParametros, obterTelaSalarioMinimo } from './tela-parametros';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { acaoAlterarParametros, acaoAlterarSalarioMinimo } = await import('./acoes-parametros');

// Ações e dados das telas de parâmetros (plano do P4, Task 9b, Step 1), pela definirAcao, com o
// prisma padrão (sgo_app) num Postgres real com o seed do cad e o plano de contas oficial (D12).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'gfin',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)),
});
const gfin = () => ctx(['cad.parametros', 'consultar'], ['cad.parametros', 'alterar'], ['cad.salario_minimo', 'consultar'], ['cad.salario_minimo', 'alterar']);
const auditor = () => ctx(['cad.parametros', 'consultar'], ['cad.salario_minimo', 'consultar']);

const versao = async (ano = 2027) => (await migrator.query('SELECT versao FROM parametros_exercicio WHERE ano = $1', [ano])).rows[0]?.versao as number;
const historicos = async () => Number((await migrator.query('SELECT count(*) AS n FROM historico_operacao')).rows[0].n);

const entrada = async () => ({
  ano: 2027,
  versao: await versao(),
  reajuste: '6',
  mesDataBase: 4,
  ipca: '4,5',
  diasUteisMes: 21,
  semaforo: { verdeAte: '70', amareloAte: '85', laranjaAte: '95' },
  encargos: [
    { componente: 'encargo.inss' as const, percentual: '37', conta: '4.1.1.2.001' },
    { componente: 'encargo.fgts' as const, percentual: '8', conta: '4.1.1.2.005' },
    { componente: 'encargo.pis' as const, percentual: '1', conta: '4.1.1.2.008' },
    { componente: 'encargo.obrigacoes' as const, percentual: '3.8', conta: '4.1.1.8.003' },
    { componente: 'encargo.riscos' as const, percentual: '0.2', conta: '4.1.1.8.004' },
  ],
  contas: { salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' },
});

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  global_.__sgoPrisma = app; // as ações usam o prisma padrão (sgo_app)
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Gestor', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
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

beforeEach(() => {
  contexto = gfin();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('dados das telas', () => {
  it('parâmetros: os anos, o pedido (ou o mais recente), textos serializáveis e só as analíticas ativas nas contas', async () => {
    const t = await obterTelaParametros(gfin(), null);
    expect(t.anos).toEqual([2027]);
    expect(t.ano).toBe(2027);
    expect(t.parametros).toMatchObject({ ano: 2027, provisorio: true, reajuste: '5.0000', semaforo: { verdeAte: '70.0000' } });
    expect(t.parametros?.provisorios).toEqual(expect.arrayContaining(['adicional', 'encargo.obrigacoes', 'encargo.riscos']));
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    expect(t.contas.length).toBeGreaterThan(50);
    expect(t.contas.every((c) => c.classificacao.split('.').length === 5)).toBe(true);
    expect(t.contas).toContainEqual(expect.objectContaining({ classificacao: '4.1.1.1.001' }));
    expect(await obterTelaParametros(gfin(), 2031)).toMatchObject({ ano: 2031, parametros: null });
  });

  it('salário mínimo: sem valor ainda; sem consultar → ErroPermissao', async () => {
    expect((await obterTelaSalarioMinimo(gfin(), 2027)).dados).toMatchObject({ ano: 2027, valor: null, congelado: false });
    await expect(obterTelaSalarioMinimo(ctx(['cad.parametros', 'consultar']), 2027)).rejects.toThrow();
  });
});

describe('acaoAlterarParametros', () => {
  it('com permissão: Resultado com a versão nova, e a tela mostra os valores', async () => {
    const e = await entrada();
    expect(await acaoAlterarParametros(e)).toEqual({ ok: true, valor: { versao: e.versao + 1 } });
    expect((await obterTelaParametros(gfin(), 2027)).parametros).toMatchObject({ reajuste: '6.0000', ipca: '4.5000', mesDataBase: 4, versao: e.versao + 1 });
  });

  it('sem alterar (auditor): 403 auditado, sem gravar', async () => {
    contexto = auditor();
    const e = await entrada();
    expect(await acaoAlterarParametros(e)).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.parametros' })]);
    expect(await versao()).toBe(e.versao);
  });

  it('campo de origem blindada: recusado e auditado pelo caso de uso (M4), sem gravar', async () => {
    const e = await entrada();
    const antes = await historicos();
    const r = await acaoAlterarParametros({ ...e, provisorio: false });
    expect(r).toMatchObject({ ok: false, erros: [{ mensagem: 'O pedido tem campos que não podem ser alterados pela tela.' }] });
    expect(await historicos()).toBe(antes + 1);
    expect(await versao()).toBe(e.versao);
  });

  it('M-n4: blindado junto com outro erro de schema, ou dentro dos encargos e das contas, também é auditado', async () => {
    const e = await entrada();
    for (const bruto of [
      { ...e, congelado: true, reajuste: 5 },
      { ...e, provisorio: false, outro: 1 },
      { ...e, encargos: e.encargos.map((x, i) => (i === 0 ? { ...x, nome: 'Outro' } : x)) },
      { ...e, contas: { ...e.contas, provisorio: false } },
    ]) {
      const antes = await historicos();
      expect(await acaoAlterarParametros(bruto)).toMatchObject({ ok: false, erros: [{ mensagem: 'O pedido tem campos que não podem ser alterados pela tela.' }] });
      expect(await historicos()).toBe(antes + 1);
    }
    expect(await versao()).toBe(e.versao);
  });

  it('campo desconhecido: recusado pelo schema (.strict), em português; versão velha: aviso de concorrência', async () => {
    const e = await entrada();
    const r = await acaoAlterarParametros({ ...e, outro: 1 });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.erros[0]?.mensagem).not.toMatch(/Unrecognized|Invalid/);
    expect(await acaoAlterarParametros({ ...e, versao: e.versao - 1 })).toMatchObject({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
  });
});

describe('acaoAlterarSalarioMinimo', () => {
  it('com permissão: grava (vírgula decimal) e devolve a versão nova; sem: 403 auditado', async () => {
    const v = await versao();
    expect(await acaoAlterarSalarioMinimo({ ano: 2027, versao: v, valor: '1518,00' })).toEqual({ ok: true, valor: { versao: v + 1 } });
    expect((await obterTelaSalarioMinimo(gfin(), 2027)).dados?.valor).toBe('1518.00');
    contexto = auditor();
    expect(await acaoAlterarSalarioMinimo({ ano: 2027, versao: v + 1, valor: '1600' })).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.salario_minimo' })]);
  });

  it('M4: campo blindado no pedido do salário mínimo é recusado e auditado, sem gravar', async () => {
    const v = await versao();
    const antes = await historicos();
    expect(await acaoAlterarSalarioMinimo({ ano: 2027, versao: v, valor: '1700', congeladoEm: null })).toMatchObject({
      ok: false,
      erros: [{ mensagem: 'O pedido tem campos que não podem ser alterados pela tela.' }],
    });
    expect(await historicos()).toBe(antes + 1);
    expect(await versao()).toBe(v);
  });

  it('valor inválido: erro no campo salarioMinimo', async () => {
    expect(await acaoAlterarSalarioMinimo({ ano: 2027, versao: await versao(), valor: '0' })).toMatchObject({
      ok: false,
      erros: [{ campo: 'salarioMinimo', mensagem: 'O salário mínimo deve ser maior que zero.' }],
    });
  });
});
