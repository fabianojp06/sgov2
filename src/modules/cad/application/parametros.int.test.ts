import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { EntradaParametros } from '../domain/parametros';
import { congelarPremissasExercicio, garantirPremissasExercicio } from '../infrastructure/premissas';
import { obterParametroSistema } from '../infrastructure/parametro-sistema';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { alterarParametrosExercicio, alterarSalarioMinimo, obterParametrosExercicio } from './parametros';

// US-053 parte 1 (plano do P4, Task 9a, Step 2), com Postgres real. Os testes compartilham o banco
// e dependem da ordem: o do congelamento, por último, deixa 2027 congelado e 2028 incompleto.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
// Funções: o usuarioId só existe depois do beforeAll.
const gfin = () => ctx(['cad.parametros:consultar', 'cad.parametros:alterar', 'cad.salario_minimo:alterar']);
const grh = () => ctx(['cad.parametros:consultar', 'cad.salario_minimo:alterar']);
const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };

const entrada: EntradaParametros = {
  reajuste: '6',
  mesDataBase: 4,
  ipca: '4.5',
  diasUteisMes: 21,
  semaforo: { verdeAte: '70', amareloAte: '85', laranjaAte: '95' },
  encargos: [
    { componente: 'encargo.inss', percentual: '37', conta: '4.1.1.2.001' },
    { componente: 'encargo.fgts', percentual: '8', conta: '4.1.1.2.005' },
    { componente: 'encargo.pis', percentual: '1', conta: '4.1.1.2.008' },
    { componente: 'encargo.obrigacoes', percentual: '3.8', conta: '4.1.1.8.003' },
    { componente: 'encargo.riscos', percentual: '0.2', conta: '4.1.1.8.004' },
  ],
  contas: { salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' },
};

const versao = async (ano = 2027) => (await migrator.query('SELECT versao FROM parametros_exercicio WHERE ano = $1', [ano])).rows[0]?.versao as number;
const ultimoHistorico = async () =>
  (await migrator.query(`SELECT funcionalidade, tipo_operacao AS tipo, descricao, antes, depois FROM historico_operacao ORDER BY id DESC LIMIT 1`)).rows[0];

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
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Gestor', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

beforeEach(() => vi.restoreAllMocks());

describe('parâmetros por exercício', () => {
  it('seed: 2027 provisório com os padrões, semáforo 70/85/95 e parametro_sistema vazio', async () => {
    const p = await obterParametrosExercicio(gfin(), 2027, { cliente: app });
    expect(p).toMatchObject({ ano: 2027, provisorio: true, congelado: false, mesDataBase: 5, diasUteisMes: 22, salarioMinimo: null });
    expect(p!.reajuste.paraString()).toBe('5.0000');
    expect(p!.semaforo.amareloAte.paraString()).toBe('85.0000');
    expect(p!.encargos.reduce((t, e) => t + Number(e.percentual.paraString()), 0)).toBeCloseTo(51);
    expect(p!.provisorios).toEqual(['adicional', 'encargo.obrigacoes', 'encargo.riscos']);
    expect(await obterParametroSistema(app, 'instituicao.nome_exibicao')).toBe('');
    expect(await obterParametrosExercicio(gfin(), 2027.5, { cliente: app })).toBeNull();
  });

  it('alteração auditada com antes e depois; versão velha → "alterado por outro usuário"', async () => {
    const v = await versao();
    expect(await alterarParametrosExercicio(gfin(), 2027, v, entrada, { cliente: app })).toEqual({ ok: true, valor: undefined });
    expect(await versao()).toBe(v + 1);
    const h = await ultimoHistorico();
    expect(h).toMatchObject({ funcionalidade: 'cad.parametros', tipo: 'ALTERACAO' });
    expect(h.antes.reajuste).toBe('5.0000');
    expect(h.depois.reajuste).toBe('6.0000');
    expect(await alterarParametrosExercicio(gfin(), 2027, v, entrada, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
  });

  it('conta que não é analítica ativa (C1 real) → erro no campo, nada gravado', async () => {
    const v = await versao();
    const r = await alterarParametrosExercicio(gfin(), 2027, v, { ...entrada, contas: { ...entrada.contas, ferias: '4.1.1.1' } }, { cliente: app });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'contas.ferias', mensagem: 'A conta deve ser analítica e ativa.' }] });
    expect(await versao()).toBe(v);
  });

  it('versão por tabela (I6): SMN e encargo incrementam a versão do ano', async () => {
    let v = await versao();
    expect((await alterarSalarioMinimo(grh(), 2027, v, '1518,00', { cliente: app })).ok).toBe(true);
    expect(await versao()).toBe(v + 1);
    expect((await ultimoHistorico()).depois).toEqual({ salarioMinimo: '1518.00' });
    v = await versao();
    expect((await alterarSalarioMinimo(grh(), 2027, v, '1520', { cliente: app })).ok).toBe(true);
    expect((await ultimoHistorico()).antes).toEqual({ salarioMinimo: '1518.00' });
    v = await versao();
    const mudaEncargo = { ...entrada, encargos: [{ ...entrada.encargos[0]!, percentual: '36' }, ...entrada.encargos.slice(1)] };
    expect((await alterarParametrosExercicio(gfin(), 2027, v, mudaEncargo, { cliente: app })).ok).toBe(true);
    expect(await versao()).toBe(v + 1);
    v = await versao();
    const mudaConta = { ...mudaEncargo, contas: { ...entrada.contas, adicional: '4.1.1.1.014' } };
    expect((await alterarParametrosExercicio(gfin(), 2027, v, mudaConta, { cliente: app })).ok).toBe(true);
    expect(await versao()).toBe(v + 1);
    expect((await migrator.query(`SELECT conta FROM conta_componente_exercicio WHERE ano = 2027 AND componente = 'adicional'`)).rows[0].conta).toBe(
      '4.1.1.1.014',
    );
  });

  it('chave desconhecida em contas, ano ou versão inválidos → erro de formulário, nada gravado', async () => {
    const v = await versao();
    const extra = { ...entrada, contas: { ...entrada.contas, 'encargo.inss': '4.1.1.1.001' } } as unknown as EntradaParametros;
    expect(await alterarParametrosExercicio(gfin(), 2027, v, extra, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'contas.encargo.inss', mensagem: 'Componente desconhecido.' }],
    });
    for (const [ano, ver] of [[2027.5, v], [2027, Number.NaN], [2027, 0]] as const) {
      expect((await alterarParametrosExercicio(gfin(), ano, ver, entrada, { cliente: app })).ok).toBe(false);
    }
    expect(await versao()).toBe(v);
  });

  it('permissão: a GRH altera o SMN, mas não os parâmetros (ErroPermissao)', async () => {
    await expect(alterarParametrosExercicio(grh(), 2027, await versao(), entrada, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('origem blindada (M4): provisorio ou versao no payload → recusado e auditado, nada muda', async () => {
    const contar = async () => (await migrator.query(`SELECT count(*)::int AS n FROM historico_operacao WHERE descricao LIKE 'cad.violacao_governanca%'`)).rows[0].n as number;
    const brutos = [
      ...['provisorio', 'versao', 'congeladoEm'].map((campo) => ({ ...entrada, [campo]: false })),
      { ...entrada, encargos: [{ ...entrada.encargos[0]!, provisorio: false }, ...entrada.encargos.slice(1)] },
      { ...entrada, contas: { ...entrada.contas, provisorio: false } },
    ];
    for (const bruto of brutos) {
      const v = await versao();
      const n = await contar();
      await expect(alterarParametrosExercicio(gfin(), 2027, v, bruto as unknown as EntradaParametros, { cliente: app })).rejects.toMatchObject({
        codigo: 'cad.violacao_governanca',
      });
      expect(await versao()).toBe(v);
      expect(await contar()).toBe(n + 1);
    }
  });

  it('§10.2 item 1: com a auditoria falhando, nada é gravado', async () => {
    const v = await versao();
    await migrator.query('REVOKE INSERT ON historico_operacao FROM sgo_app');
    try {
      await expect(alterarParametrosExercicio(gfin(), 2027, v, entrada, { cliente: app })).rejects.toThrow();
    } finally {
      await migrator.query(`GRANT INSERT ("unidade_id", "usuario_id", "usuario_rotulo", "sessao_uid", "ip", "funcionalidade",
        "tipo_operacao", "registro_id", "descricao", "antes", "depois", "delta", "origem") ON historico_operacao TO sgo_app`);
    }
    expect(await versao()).toBe(v);
  });

  it('garantir concorrente do mesmo ano: as duas chamadas terminam, uma cria', async () => {
    const [a, b] = await Promise.all([
      app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2040)),
      app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2040)),
    ]);
    expect(a.ano).toBe(2040);
    expect(b.ano).toBe(2040);
    expect((await migrator.query('SELECT count(*)::int AS n FROM encargo_exercicio WHERE ano = 2040')).rows[0].n).toBe(5);
  });

  it('garantir(2028) copia 2027 e audita; a segunda chamada não faz nada; sem ano anterior, usa os padrões', async () => {
    const p = await app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2028));
    expect(p).toMatchObject({ ano: 2028, versao: 1, beneficios: [] });
    expect(p.reajuste.paraString()).toBe('6.0000');
    expect(p.salarioMinimo?.paraString()).toBe('1520.00');
    const n = (await migrator.query('SELECT count(*)::int AS n FROM historico_operacao')).rows[0].n;
    await app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2028));
    expect((await migrator.query('SELECT count(*)::int AS n FROM historico_operacao')).rows[0].n).toBe(n);
    const padrao = await app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2001));
    expect(padrao.reajuste.paraString()).toBe('5.0000');
    expect(padrao.provisorio).toBe(true);
  });

  it('congelar(2027): depois dele, qualquer alteração → cad.exercicio_congelado; INSERT direto recusado pelo trigger', async () => {
    await app.$transaction((tx) => congelarPremissasExercicio(tx, SISTEMA, 2027));
    const v = await versao();
    expect(await alterarSalarioMinimo(grh(), 2027, v, '1600', { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: expect.stringContaining('congelados') }],
    });
    await expect(migrator.query(`UPDATE encargo_exercicio SET percentual = 1 WHERE ano = 2027 AND componente = 'encargo.pis'`)).rejects.toThrow(
      /congelados/,
    );
    await expect(migrator.query(`UPDATE parametros_exercicio SET congelado_em = NULL WHERE ano = 2027`)).rejects.toThrow(/congelados/);
    expect(await alterarParametrosExercicio(gfin(), 2027, v, entrada, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: expect.stringContaining('congelados') }],
    });
    // Defesa no banco, como o dono das tabelas: INSERT, DELETE, UPDATE e troca de ano, nas duas tabelas filhas.
    await expect(migrator.query(`DELETE FROM encargo_exercicio WHERE ano = 2027 AND componente = 'encargo.pis'`)).rejects.toThrow(/congelados/);
    await expect(migrator.query(`UPDATE conta_componente_exercicio SET conta = 'x' WHERE ano = 2027`)).rejects.toThrow(/congelados/);
    await expect(migrator.query(`UPDATE encargo_exercicio SET ano = 2028 WHERE ano = 2027 AND componente = 'encargo.pis'`)).rejects.toThrow(/congelados/);
    await migrator.query(`DELETE FROM encargo_exercicio WHERE ano = 2028 AND componente = 'encargo.riscos'`);
    await migrator.query(`UPDATE parametros_exercicio SET congelado_em = now() WHERE ano = 2028`);
    await expect(
      migrator.query(`INSERT INTO encargo_exercicio (ano, componente, nome, percentual, conta) VALUES (2028, 'encargo.riscos', 'R', 0.2, '4.1.1.8.004')`),
    ).rejects.toThrow(/congelados/);
    await expect(
      migrator.query(`INSERT INTO conta_componente_exercicio (ano, componente, conta) VALUES (2028, 'salario', '4.1.1.1.001') ON CONFLICT DO NOTHING`),
    ).rejects.toThrow(/congelados/);
    // Congelar de novo é idempotente; ano sem parâmetros dá erro.
    await expect(app.$transaction((tx) => congelarPremissasExercicio(tx, SISTEMA, 2027))).resolves.toBeUndefined();
    await expect(app.$transaction((tx) => congelarPremissasExercicio(tx, SISTEMA, 2099))).rejects.toMatchObject({ codigo: 'cad.premissas_inexistentes' });
  });
});
