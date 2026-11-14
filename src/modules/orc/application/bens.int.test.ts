import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto, type NoConta } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { alterarBem, excluirBem, incluirBem, listarBens, opcoesBem } from './bens';
import type { DepsOrc } from './deps';
import { incluirMeta } from './metas';
import { criarProposta, duplicarProposta, novaVersaoProposta } from './propostas';

// Bens, serviços e equipamentos da proposta de TP (US-072; plano do P22, Task 1). Como sgo_app (RLS real). O C1
// é o falso do cad, com um trecho de imobilizado (4.2.1) e uma conta de custeio (4.1.1.5.005).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, descricao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `90.${classificacao}`,
  descricao,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: analitico ? 'ANALITICO' : 'SINTETICO',
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: true,
  filhos,
});
const conta = (classificacao: string, descricao: string, filhos: NoConta[] = []): NoConta => {
  const nivel = classificacao.split('.').length as NoConta['nivel'];
  return {
    classificacao,
    codigoReduzido: nivel === 5 ? `8${classificacao.replace(/\./g, '')}` : null,
    descricao,
    nivel,
    tipo: nivel === 5 ? 'ANALITICA' : 'SINTETICA',
    ativa: true,
    filhos,
  };
};
const CONTAS: NoConta[] = [
  conta('4', 'DESPESAS', [
    conta('4.1', 'DESPESAS OPERACIONAIS', [conta('4.1.1', 'SERVIÇOS', [conta('4.1.1.5', 'ADMINISTRATIVAS', [conta('4.1.1.5.005', 'Material de escritório')])])]),
    conta('4.2', 'INVESTIMENTOS', [conta('4.2.1', 'IMOBILIZADO', [conta('4.2.1.1', 'EQUIPAMENTOS', [conta('4.2.1.1.001', 'Computadores'), conta('4.2.1.1.002', 'Mobiliário')])])]),
  ]),
];
const RAIZ_TPS = cc('9', 'Termos de Parceria', false, [cc('9.1', 'TP de exemplo 1', true), cc('9.2', 'TP de exemplo 2', true)]);
const estrutura = estruturaFinanceiraFalsa({ contas: CONTAS, centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
const comDeps = (extra: Partial<DepsOrc> = {}): Partial<DepsOrc> => ({ cliente: app, estrutura, ...extra });

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const TODAS = ['orc.propostas:consultar', 'orc.propostas:incluir', 'orc.propostas:excluir', ...LANCA.map((a) => `orc.metas:${a}`), ...LANCA.map((a) => `orc.bens:${a}`)];
let seq = 0;
let orcamentista: string;

async function usuario(): Promise<string> {
  const login = `bem${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId = orcamentista, permissoes: string[] = TODAS): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'orcamentista', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}

async function proposta(extra: Record<string, unknown> = {}) {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-12-31', categoria: 'META', cc: '9.1', ...extra },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
const versaoCapa = async (id: string) => (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
async function meta(propostaId: string, numero = 'M1') {
  const r = await incluirMeta(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), numero, nome: `Meta ${numero}`, valor: '0', status: 'ATIVO' }, comDeps());
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.metaProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId }, numero }, orderBy: { criadoEm: 'desc' } });
}
const item = (extra: Record<string, unknown> = {}) => ({ conta: '4.2.1.1.001', descricao: 'Notebook', data: '2027-05-10', quantidade: '3', valorUnitario: '1.234,56', ...extra });
async function incluir(propostaId: string, metaId: string | undefined, extra: Record<string, unknown> = {}) {
  const r = await incluirBem(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), ...(metaId ? { metaId } : {}), ...item(extra) }, comDeps());
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.bemProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId } }, orderBy: { criadoEm: 'desc' } });
}
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });
const erroCampo = (campo: string, mensagem: string) => ({ ok: false, erros: [{ campo, mensagem }] });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
});

describe('incluirBem (UC03.35)', () => {
  it('grava na meta, sobe a capa e o Histórico leva o total (RN0157)', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const antes = await versaoCapa(p.id);
    expect(await incluirBem(await ctx(), { propostaId: p.id, versaoCapa: antes, metaId: m.id, ...item() }, comDeps())).toEqual({ ok: true, valor: { descricao: 'Notebook' } });
    const b = await migrator.bemProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id } } });
    expect(b).toMatchObject({ metaId: m.id, conta: '4.2.1.1.001', quantidade: 3, ativo: true, origemId: null, data: new Date('2027-05-10T00:00:00Z') });
    expect(await versaoCapa(p.id)).toBe(antes + 1);
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.bens', registroId: b.id } });
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', depois: { meta: 'M1', data: '2027-05-10', valorUnitario: '1234.56', valorTotal: '3703.68' } });
  });

  it('na Consolidada, sem meta; na categoria Meta, a meta é obrigatória', async () => {
    const c = await proposta({ categoria: 'CONSOLIDADA' });
    expect((await incluirBem(await ctx(), { propostaId: c.id, versaoCapa: await versaoCapa(c.id), ...item() }, comDeps())).ok).toBe(true);
    const p = await proposta({ cc: '9.2' });
    expect(await incluirBem(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), ...item() }, comDeps())).toEqual(
      erroCampo('metaId', M.EMPREGADO_META_OBRIGATORIA),
    );
  });

  it('conta sintética recusada; com o filtro CAPEX injetado, a de custeio também (D-P22-3)', async () => {
    const p = await proposta({ categoria: 'CONSOLIDADA' });
    const tentar = async (c: string, extra: Partial<DepsOrc> = {}) =>
      incluirBem(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), ...item({ conta: c }) }, comDeps(extra));
    expect(await tentar('4.2.1.1')).toEqual(erroCampo('conta', M.BEM_CONTA_ANALITICA));
    const capex = (c: string) => c.startsWith('4.2.');
    expect(await tentar('4.1.1.5.005', { contaCapex: capex })).toEqual(erroCampo('conta', M.BEM_CONTA_NAO_CAPEX));
    expect((await tentar('4.1.1.5.005')).ok).toBe(true);
    expect((await opcoesBem(await ctx(), comDeps({ contaCapex: capex }))).contas.map((x) => x.classificacao)).toEqual(['4.2.1.1.001', '4.2.1.1.002']);
  });

  it('versão imutável e corrida pela mesma versão da capa (Review Focus 5)', async () => {
    const p = await proposta({ categoria: 'CONSOLIDADA' });
    const corpo = { propostaId: p.id, versaoCapa: await versaoCapa(p.id), ...item() };
    const [a, b] = await Promise.all([incluirBem(await ctx(), corpo, comDeps()), incluirBem(await ctx(), corpo, comDeps())]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_APROVACAO' } });
    expect(await incluirBem(await ctx(), { ...corpo, versaoCapa: await versaoCapa(p.id) }, comDeps())).toEqual(erroGeral(M.BEM_VERSAO_IMUTAVEL));
  });
});

describe('alterarBem e excluirBem (UC03.36, UC03.37)', () => {
  it('alterar troca a meta e a conta (D-P22-4), com o antes e o depois no Histórico', async () => {
    const p = await proposta();
    const m1 = await meta(p.id, 'M1');
    const m2 = await meta(p.id, 'M2');
    const b = await incluir(p.id, m1.id);
    const r = await alterarBem(
      await ctx(),
      {
        id: b.id,
        versao: 0,
        versaoCapa: await versaoCapa(p.id),
        metaId: m2.id,
        ...item({ conta: '4.2.1.1.002', descricao: 'Cadeiras', quantidade: '10', valorUnitario: '300,00' }),
      },
      comDeps(),
    );
    expect(r).toEqual({ ok: true, valor: { descricao: 'Cadeiras' } });
    expect(await migrator.bemProposta.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ metaId: m2.id, conta: '4.2.1.1.002', quantidade: 10, versao: 1 });
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.bens', registroId: b.id, tipoOperacao: 'ALTERACAO' } });
    expect(h).toMatchObject({ antes: { meta: 'M1', valorTotal: '3703.68' }, depois: { meta: 'M2', valorTotal: '3000.00' } });
  });

  it('o bem nascido na versão é apagado; o copiado de V1 é inativado em V2, e o V1 fica intacto (Review Focus 1)', async () => {
    const p = await proposta({ categoria: 'CONSOLIDADA' });
    const v1Bem = await incluir(p.id, undefined);
    expect((await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps())).ok).toBe(true);
    const copiado = await migrator.bemProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id, numero: 2 } } });
    expect(copiado.origemId).toBe(v1Bem.id);
    const novo = await incluir(p.id, undefined, { descricao: 'Impressora' });
    expect(await excluirBem(await ctx(), { id: copiado.id, versao: 0, versaoCapa: await versaoCapa(p.id) }, comDeps())).toEqual({
      ok: true,
      valor: { descricao: 'Notebook', inativado: true },
    });
    expect(await migrator.bemProposta.findUniqueOrThrow({ where: { id: copiado.id } })).toMatchObject({ ativo: false });
    expect((await migrator.bemProposta.findUniqueOrThrow({ where: { id: v1Bem.id } })).ativo).toBe(true);
    expect(await excluirBem(await ctx(), { id: novo.id, versao: 0, versaoCapa: await versaoCapa(p.id) }, comDeps())).toEqual({
      ok: true,
      valor: { descricao: 'Impressora', inativado: false },
    });
    expect(await migrator.bemProposta.count({ where: { id: novo.id } })).toBe(0);
    // O inativo não se altera nem sai de novo.
    expect(await alterarBem(await ctx(), { id: copiado.id, versao: 1, versaoCapa: await versaoCapa(p.id), ...item() }, comDeps())).toEqual(erroGeral(M.BEM_INATIVO));
    const [b] = await listarBens(await ctx(), { proposta: p.numero }, comDeps());
    expect(b!.grupos).toHaveLength(0);
    expect(b!.inativos).toBe(1);
    const [comInativos] = await listarBens(await ctx(), { proposta: p.numero, exibirInativos: true }, comDeps());
    expect(comInativos!.listaInativos.map((x) => x.descricao)).toEqual(['Notebook']);
  });

  it('a nova versão não leva os inativos (Review Focus 2)', async () => {
    const p = await proposta({ categoria: 'CONSOLIDADA' });
    await incluir(p.id, undefined);
    await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps());
    const copiado = await migrator.bemProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id, numero: 2 } } });
    await excluirBem(await ctx(), { id: copiado.id, versao: 0, versaoCapa: await versaoCapa(p.id) }, comDeps());
    await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps());
    expect(await migrator.bemProposta.count({ where: { versaoProposta: { propostaId: p.id, numero: 3 } } })).toBe(0);
  });
});

describe('listarBens e cópia (RN0415, RN0417, RN_DUP_003)', () => {
  it('grupos por conta com subtotal, total geral, filtros e consulta do GFIN', async () => {
    const p = await proposta({ categoria: 'CONSOLIDADA' });
    await incluir(p.id, undefined, { conta: '4.2.1.1.002', descricao: 'Cadeiras', quantidade: '10', valorUnitario: '300,00' });
    await incluir(p.id, undefined);
    await incluir(p.id, undefined, { descricao: 'Brinde', valorUnitario: '0', data: '2027-11-01' });
    const consulta = await ctx(orcamentista, ['orc.bens:consultar']);
    const [b] = await listarBens(consulta, { proposta: p.numero }, comDeps());
    expect(b!.grupos.map((g) => [g.conta, g.descricaoConta, g.itens.length, g.subtotal.paraString()])).toEqual([
      ['4.2.1.1.001', 'Computadores', 2, '3703.68'],
      ['4.2.1.1.002', 'Mobiliário', 1, '3000.00'],
    ]);
    expect(b!.total.paraString()).toBe('6703.68');
    const [sem] = await listarBens(consulta, { proposta: p.numero, exibirZerados: false }, comDeps());
    expect(sem!.grupos[0]!.itens.map((x) => x.descricao)).toEqual(['Notebook']);
    const [periodo] = await listarBens(consulta, { proposta: p.numero, inicio: '2027-10-01' }, comDeps());
    expect(periodo!.grupos.flatMap((g) => g.itens.map((x) => x.descricao))).toEqual(['Brinde']);
    const [porConta] = await listarBens(consulta, { proposta: p.numero, conta: 'mobili' }, comDeps());
    expect(porConta!.grupos.map((g) => g.conta)).toEqual(['4.2.1.1.002']);
  });

  it('a duplicação com vigência menor só leva o que cabe, sem origem (Review Focus 4)', async () => {
    const p = await proposta({ categoria: 'CONSOLIDADA' });
    await incluir(p.id, undefined, { descricao: 'Dentro', data: '2027-03-01' });
    await incluir(p.id, undefined, { descricao: 'Fora', data: '2027-11-01' });
    const d = await duplicarProposta(
      await ctx(),
      { origemId: p.id, versaoOrigem: await versaoCapa(p.id), numero: `TP-D${++seq}`, cc: '9.2', inicio: '2027-01-01', fim: '2027-06-30' },
      comDeps(),
    );
    if (!d.ok) throw new Error(JSON.stringify(d.erros));
    const copiados = await migrator.bemProposta.findMany({ where: { versaoProposta: { propostaId: d.valor.id } } });
    expect(copiados.map((x) => [x.descricao, x.origemId])).toEqual([['Dentro', null]]);
  });
});
