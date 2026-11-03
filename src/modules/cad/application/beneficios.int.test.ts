import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { EntradaBeneficio } from '../domain/beneficios';
import { congelarPremissasExercicio, garantirPremissasExercicio } from '../infrastructure/premissas';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { alterarBeneficioMestre, incluirBeneficioMestre, listarAnosBeneficios, listarBeneficiosMestre } from './beneficios';

// US-050 parte 1 (plano do P4, Task 10, Step 1), com Postgres real. Os testes compartilham o banco e
// dependem da ordem (o congelamento de 2027 vem por último).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'Teste', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(permissoes) });
const grh = () => ctx(['cad.beneficios:consultar', 'cad.beneficios:incluir', 'cad.beneficios:alterar']);
const gfin = () => ctx(['cad.beneficios:consultar']);
const vr = (extra: Partial<EntradaBeneficio> = {}): EntradaBeneficio => ({
  codigo: 'beneficio.vr',
  nome: 'Vale-refeição',
  forma: 'VALOR_DIARIO',
  valor: '36.50',
  percentual: null,
  conta: '4.1.1.1.009',
  padraoPosicao: true,
  ativo: true,
  ...extra,
});
const versaoAno = async () => (await migrator.query('SELECT versao FROM parametros_exercicio WHERE ano = 2027')).rows[0].versao as number;
const versaoItem = async (codigo: string) =>
  (await migrator.query('SELECT versao FROM beneficio_mestre WHERE ano = 2027 AND codigo = $1', [codigo])).rows[0].versao as number;

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
    VALUES ('GRH', 'grh@exemplo.org', 'grh', 'grh', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('Tabela Mestre de Benefícios', () => {
  it('seed: os 7 itens de 2027, provisórios e sem valor', async () => {
    const itens = await listarBeneficiosMestre(gfin(), 2027, { cliente: app });
    expect(itens.map((i) => i.codigo)).toEqual([
      'beneficio.odonto',
      'beneficio.saude_basico',
      'beneficio.saude_executivo',
      'beneficio.saude_intermediario',
      'beneficio.seguro_vida',
      'beneficio.va',
      'beneficio.vr',
    ]);
    expect(itens.every((i) => i.provisorio && i.valor === null)).toBe(true);
    expect(itens.filter((i) => i.padraoPosicao).map((i) => i.codigo)).toEqual(['beneficio.saude_basico', 'beneficio.seguro_vida', 'beneficio.vr']);
  });

  it('exercícios para o seletor de ano: os que têm parâmetros; exige consultar', async () => {
    expect(await listarAnosBeneficios(gfin(), { cliente: app })).toEqual([2027]);
    await expect(listarAnosBeneficios(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('alteração auditada, sai do provisório e incrementa a versão do ano (I6)', async () => {
    const va = await versaoAno();
    expect(await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', await versaoItem('beneficio.vr'), vr(), { cliente: app })).toEqual({ ok: true, valor: undefined });
    expect(await versaoAno()).toBe(va + 1);
    const vrNovo = (await listarBeneficiosMestre(gfin(), 2027, { cliente: app })).find((i) => i.codigo === 'beneficio.vr')!;
    expect(vrNovo).toMatchObject({ provisorio: false, versao: 2 });
    expect(vrNovo.valor?.paraString()).toBe('36.50');
    const h = (await migrator.query(`SELECT antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.beneficios' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect([h.antes.valor, h.depois.valor, h.depois.provisorio]).toEqual([null, '36.50', false]);
  });

  it('versão velha do item → erro de concorrência, nada muda', async () => {
    const va = await versaoAno();
    const r = await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', 1, vr({ valor: '40' }), { cliente: app });
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }] });
    expect(await versaoAno()).toBe(va);
  });

  it('a forma e o código não mudam; conta que não é analítica ativa → erro', async () => {
    const v = await versaoItem('beneficio.vr');
    expect((await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', v, vr({ forma: 'VALOR_MENSAL' }), { cliente: app })).ok).toBe(false);
    expect(await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', v, vr({ conta: '4.1.1.1' }), { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'conta', mensagem: 'A conta deve ser analítica e ativa.' }],
    });
  });

  it('inclusão de item percentual (R14a); código repetido → erro', async () => {
    const novo = vr({ codigo: 'beneficio.previdencia', nome: 'Previdência', forma: 'PERCENTUAL_SALARIO', valor: null, percentual: '2', conta: '4.1.1.1.006', padraoPosicao: false });
    const va = await versaoAno();
    expect((await incluirBeneficioMestre(grh(), 2027, novo, { cliente: app })).ok).toBe(true);
    expect(await versaoAno()).toBe(va + 1);
    expect(await incluirBeneficioMestre(grh(), 2027, novo, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'codigo', mensagem: 'Já existe um benefício com esse código neste exercício.' }],
    });
  });

  it('origem blindada também na inclusão', async () => {
    const bruto = { ...vr({ codigo: 'beneficio.outro' }), provisorio: false } as unknown as EntradaBeneficio;
    await expect(incluirBeneficioMestre(grh(), 2027, bruto, { cliente: app })).rejects.toMatchObject({ codigo: 'cad.violacao_governanca' });
  });

  it('GFIN não altera (ErroPermissao); origem blindada recusada e auditada', async () => {
    await expect(alterarBeneficioMestre(gfin(), 2027, 'beneficio.vr', 2, vr(), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    const n = async () => (await migrator.query(`SELECT count(*)::int AS n FROM historico_operacao WHERE descricao LIKE 'cad.violacao_governanca%'`)).rows[0].n as number;
    const antes = await n();
    const bruto = { ...vr(), provisorio: false } as unknown as EntradaBeneficio;
    await expect(alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', await versaoItem('beneficio.vr'), bruto, { cliente: app })).rejects.toMatchObject({
      codigo: 'cad.violacao_governanca',
    });
    expect(await n()).toBe(antes + 1);
  });

  it('§10.2 item 1: com a auditoria falhando, nada é gravado', async () => {
    const v = await versaoItem('beneficio.vr');
    await migrator.query('REVOKE INSERT ON historico_operacao FROM sgo_app');
    try {
      await expect(alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', v, vr({ valor: '50' }), { cliente: app })).rejects.toThrow(/permission denied/);
    } finally {
      await migrator.query(`GRANT INSERT ("unidade_id", "usuario_id", "usuario_rotulo", "sessao_uid", "ip", "funcionalidade",
        "tipo_operacao", "registro_id", "descricao", "antes", "depois", "delta", "origem") ON historico_operacao TO sgo_app`);
    }
    expect(await versaoItem('beneficio.vr')).toBe(v);
  });

  it('garantir(2028) copia os itens de 2027 com valores, formas, contas e padrão (I5); a segunda vez não duplica', async () => {
    await app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2028));
    await app.$transaction((tx) => garantirPremissasExercicio(tx, SISTEMA, 2028));
    const a = await listarBeneficiosMestre(gfin(), 2027, { cliente: app });
    const b = await listarBeneficiosMestre(gfin(), 2028, { cliente: app });
    const resumo = (xs: typeof a) => xs.map((i) => [i.codigo, i.forma, i.valor?.paraString() ?? null, i.percentual?.paraString() ?? null, i.conta, i.padraoPosicao]);
    expect(resumo(b)).toEqual(resumo(a));
    expect(b).toHaveLength(8);
  });

  it('ano congelado → cad.exercicio_congelado; INSERT direto recusado pelo trigger', async () => {
    await app.$transaction((tx) => congelarPremissasExercicio(tx, SISTEMA, 2027));
    const r = await alterarBeneficioMestre(grh(), 2027, 'beneficio.vr', await versaoItem('beneficio.vr'), vr({ valor: '60' }), { cliente: app });
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: expect.stringContaining('congelados') }] });
    await expect(
      migrator.query(`INSERT INTO beneficio_mestre (ano, codigo, nome, forma, conta) VALUES (2027, 'beneficio.x', 'X', 'VALOR_MENSAL', '4.1.1.1.008')`),
    ).rejects.toThrow(/congelados/);
  });

});
