import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CENTROS_CUSTO_EXEMPLO,
  calcularCustoPosicao,
  cargosExemplo,
  custoPessoalFalso,
  estruturaFinanceiraFalsa,
  premissasExemplo,
  type CargoExercicio,
  type NoCentroCusto,
} from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { DepsOrc } from './deps';
import { alterarEmpregado, cargosParaEmpregado, excluirEmpregado, incluirEmpregado, listarEmpregados } from './empregados';
import { excluirMeta, incluirMeta } from './metas';
import { criarProposta, duplicarProposta, novaVersaoProposta } from './propostas';
import { alterarQtde, excluirQtde, incluirQtde, listarQtdes } from './qtde-empregados';

// Pessoal da proposta de TP (US-070; plano do P20, Task 1). Como sgo_app (RLS real). O C2 é o falso do cad:
// premissas de 2027 só (2028 fica sem parâmetros, D-P20-4) e o custo = salário × meses, para conferir à mão.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const no = (classificacao: string, descricao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
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
const RAIZ_TPS = no('9', 'Termos de Parceria', false, [no('9.1', 'TP de exemplo 1', true), no('9.2', 'TP de exemplo 2', true)]);
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
const [C001, C002, C003] = cargosExemplo().map((c) => c.id) as [string, string, string];

function comDeps(cargos: readonly CargoExercicio[] = cargosExemplo(), extra: Partial<DepsOrc> = {}): Partial<DepsOrc> {
  const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargos), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
  return { cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio, ...extra };
}

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const TODAS = [
  'orc.propostas:consultar',
  'orc.propostas:incluir',
  'orc.propostas:excluir',
  ...LANCA.map((a) => `orc.metas:${a}`),
  ...LANCA.map((a) => `orc.empregados:${a}`),
  ...LANCA.map((a) => `orc.qtde_empregados:${a}`),
];
let seq = 0;
let orcamentista: string;
let outro: string;

async function usuario(): Promise<string> {
  const login = `pes${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId = orcamentista, permissoes: string[] = TODAS): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'orcamentista', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}

/** Proposta nova (Meta, vigência 2027 inteira, por padrão). */
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
async function meta(propostaId: string, numero = 'M1', status = 'ATIVO') {
  const r = await incluirMeta(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), numero, nome: `Meta ${numero}`, valor: '0', status }, comDeps());
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.metaProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId }, numero }, orderBy: { criadoEm: 'desc' } });
}
const empregado = (extra: Record<string, unknown> = {}) => ({ categoria: 'EMPREGADO', nome: '', cargoId: C001, inicio: '2027-03', fim: '2027-12', dependentes: '1', ...extra });
async function incluir(propostaId: string, extra: Record<string, unknown> = {}, deps = comDeps()) {
  const r = await incluirEmpregado(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), ...empregado(extra) }, deps);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.empregadoProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId } }, orderBy: { criadoEm: 'desc' } });
}
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });
const erroCampo = (campo: string, mensagem: string) => ({ ok: false, erros: [{ campo, mensagem }] });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
  outro = await usuario();
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

// Cada teste começa com os CCs de TP livres (9.1 e 9.2).
beforeEach(async () => {
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
});

describe('incluirEmpregado (UC03.25)', () => {
  it('nome vazio é "A CONTRATAR": grava com a Fonte Ativa do cargo, ordem 1 na meta, sobe a capa e o Histórico vai sem o salário', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const r = await incluirEmpregado(await ctx(), { propostaId: p.id, versaoCapa: 1, metaId: m.id, ...empregado() }, comDeps());
    expect(r).toEqual({ ok: true, valor: { ordem: 1, nome: 'A CONTRATAR' } });
    const e = await migrator.empregadoProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id } } });
    expect(e).toMatchObject({ metaId: m.id, ordem: 1, categoria: 'EMPREGADO', nome: null, cargoId: C001, dependentes: 1, unidadeId: p.unidadeId, criadoPor: orcamentista });
    expect(e.salarioMensal.toString()).toBe('7500');
    expect(e.inicio).toEqual(new Date('2027-03-01T00:00:00Z'));
    expect(await versaoCapa(p.id)).toBe(2);
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.empregados', registroId: e.id } });
    expect(h).toMatchObject({
      tipoOperacao: 'INSERCAO',
      descricao: `Empregado 1 (A CONTRATAR) incluído na versão 1 da proposta do TP ${p.numero}`,
      depois: { numeroTp: p.numero, versaoProposta: 1, meta: 'M1', ordem: 1, categoria: 'EMPREGADO', nome: 'A CONTRATAR', inicio: '2027-03', fim: '2027-12', dependentes: 1 },
    });
    expect(JSON.stringify(h!.depois)).not.toContain('7500');
  });

  it('a ordem recomeça a cada meta (RN0242)', async () => {
    const p = await proposta();
    const m1 = await meta(p.id, 'M1');
    const m2 = await meta(p.id, 'M2');
    await incluir(p.id, { metaId: m1.id, nome: 'Ana' });
    await incluir(p.id, { metaId: m1.id, nome: 'Bia' });
    await incluir(p.id, { metaId: m2.id, nome: 'Caio' });
    const todos = await migrator.empregadoProposta.findMany({ where: { versaoProposta: { propostaId: p.id } }, orderBy: { criadoEm: 'asc' } });
    expect(todos.map((e) => [e.nome, e.ordem])).toEqual([
      ['Ana', 1],
      ['Bia', 2],
      ['Caio', 1],
    ]);
  });

  it('meta: obrigatória na categoria Meta, só ativa e da versão; na Consolidada, nenhuma (RN0245, RN_VIA_04); recusa não sobe a capa', async () => {
    const p = await proposta();
    const inativa = await meta(p.id, 'M9', 'INATIVO');
    const q = await proposta({ cc: '9.2' });
    const deOutra = await meta(q.id);
    const base = async (id: string, extra: Record<string, unknown>) => ({ propostaId: id, versaoCapa: await versaoCapa(id), ...empregado(extra) });
    expect(await incluirEmpregado(await ctx(), await base(p.id, {}), comDeps())).toEqual(erroCampo('metaId', M.EMPREGADO_META_OBRIGATORIA));
    expect(await incluirEmpregado(await ctx(), await base(p.id, { metaId: inativa.id }), comDeps())).toEqual(erroCampo('metaId', M.EMPREGADO_META_INVALIDA));
    expect(await incluirEmpregado(await ctx(), await base(p.id, { metaId: deOutra.id }), comDeps())).toEqual(erroCampo('metaId', M.EMPREGADO_META_INVALIDA));
    expect(await versaoCapa(p.id)).toBe(1);

    await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
    const c = await proposta({ categoria: 'CONSOLIDADA' });
    expect(await incluirEmpregado(await ctx(), await base(c.id, { metaId: deOutra.id }), comDeps())).toEqual(erroCampo('metaId', M.META_SEM_CATEGORIA));
    await expect(incluir(c.id, { nome: 'Sem meta' })).resolves.toMatchObject({ metaId: null, ordem: 1 });
  });

  it('cargo: inativo, sem Fonte Ativa ou fora do cadastro recusado; sem a chave da cifra, recusa sem gravar', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const base = { propostaId: p.id, versaoCapa: 1, metaId: m.id };
    expect(await incluirEmpregado(await ctx(), { ...base, ...empregado({ cargoId: C003 }) }, comDeps())).toEqual(erroCampo('cargoId', M.CARGO_SEM_FONTE_ATIVA));
    expect(await incluirEmpregado(await ctx(), { ...base, ...empregado({ cargoId: '00000000-0000-4000-8000-0000000000ff' }) }, comDeps())).toEqual(
      erroCampo('cargoId', M.CARGO_NAO_ENCONTRADO),
    );
    const semChave = comDeps(cargosExemplo(), {
      cargosDecifrados: async () => {
        throw new ErroDominio('cad.cifra_indisponivel', 'sem chave');
      },
    });
    expect(await incluirEmpregado(await ctx(), { ...base, ...empregado() }, semChave)).toEqual(erroCampo('cargoId', M.EMPREGADO_CARGO_SEM_SALARIO));
    expect(await migrator.empregadoProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(0);
    expect(await versaoCapa(p.id)).toBe(1);
  });

  it('competência fora da vigência, versão fora de Rascunho/Em Elaboração e capa velha: recusados sem subir a capa', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const base = { propostaId: p.id, versaoCapa: 1, metaId: m.id };
    expect(await incluirEmpregado(await ctx(), { ...base, ...empregado({ fim: '2028-01' }) }, comDeps())).toEqual(
      erroCampo('fim', M.COMPETENCIA_DEPOIS_DA_VIGENCIA('12/2027')),
    );
    expect(await incluirEmpregado(await ctx(), { ...base, versaoCapa: 0, ...empregado() }, comDeps())).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_APROVACAO' } });
    expect(await incluirEmpregado(await ctx(), { ...base, ...empregado() }, comDeps())).toEqual(erroGeral(M.EMPREGADO_VERSAO_IMUTAVEL));
    expect(await versaoCapa(p.id)).toBe(1);
  });

  it('duas abas com a mesma versão da capa: uma grava, a outra recebe ALTERADO_POR_OUTRO', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const corpo = { propostaId: p.id, versaoCapa: 1, metaId: m.id, ...empregado() };
    const r = await Promise.all([incluirEmpregado(await ctx(), corpo, comDeps()), incluirEmpregado(await ctx(), corpo, comDeps())]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok)).toEqual([erroGeral(M.ALTERADO_POR_OUTRO)]);
    expect(await migrator.empregadoProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(1);
  });

  it('campos de origem blindada (ordem, salário) recusados com ErroDominio', async () => {
    const p = await proposta();
    await expect(incluirEmpregado(await ctx(), { propostaId: p.id, versaoCapa: 0, ...empregado(), salarioMensal: '1' }, comDeps())).rejects.toThrow(ErroDominio);
  });
});

describe('listarEmpregados (UC03.24)', () => {
  it('custo pelo motor ano a ano (D-P20-4): o primeiro mês e o período; ano sem parâmetros fica de fora, com aviso', async () => {
    const p = await proposta({ fim: '2028-06-30' });
    const m = await meta(p.id);
    await incluir(p.id, { metaId: m.id, nome: 'Ana', inicio: '2027-03', fim: '2028-02' });
    await incluir(p.id, { metaId: m.id, categoria: 'ESTAGIARIO', cargoId: C002, inicio: '2027-11', fim: '2027-12' });
    const [b] = await listarEmpregados(await ctx(), { proposta: p.numero }, comDeps());
    expect(b).toMatchObject({ numero: p.numero, categoria: 'META', editavel: true, veCusto: true, vigencia: { inicio: '2027-01', fim: '2028-06' } });
    expect(b!.metas.map((x) => x.numero)).toEqual(['M1']);
    const [g] = b!.grupos;
    expect(g).toMatchObject({ metaNumero: 'M1', totais: { EMPREGADO: 1, ESTAGIARIO: 1, JOVEM_APRENDIZ: 0 } });
    const [ana, vaga] = g!.empregados;
    expect(ana).toMatchObject({ ordem: 1, nome: 'Ana', cargo: 'C001 – Analista de orçamento', inicio: '2027-03', fim: '2028-02', avisos: [M.EMPREGADO_SEM_PARAMETROS(2028)] });
    expect(ana!.custoMensal!.paraString()).toBe('7500.00');
    expect(ana!.custoPeriodo!.paraString()).toBe(Dinheiro.de('7500').multiplicar('10').paraString());
    expect(vaga).toMatchObject({ ordem: 2, nome: null, categoria: 'ESTAGIARIO' });
    expect(vaga!.custoPeriodo!.paraString()).toBe('8400.00');
    expect(b!.totais).toEqual({ EMPREGADO: 1, ESTAGIARIO: 1, JOVEM_APRENDIZ: 0 });
  });

  it('cada ano com os benefícios dele (motor real do cad): o cache de benefícios do cargo é por ano', async () => {
    const p2027 = premissasExemplo(2027);
    const p2028 = { ...premissasExemplo(2028), beneficios: premissasExemplo(2028).beneficios.map((b) => (b.forma === 'VALOR_MENSAL' ? { ...b, valorMensal: Dinheiro.de('999.00') } : b)) };
    const falso = custoPessoalFalso([p2027, p2028]);
    const deps = comDeps(cargosExemplo(), { custoPessoal: { ...falso, calcularCustoPosicao } });
    const p = await proposta({ fim: '2028-12-31' });
    const m = await meta(p.id);
    await incluir(p.id, { metaId: m.id, inicio: '2027-12', fim: '2028-01' }, deps);
    const [b] = await listarEmpregados(await ctx(), { proposta: p.numero }, deps);
    const e = b!.grupos[0]!.empregados[0]!;
    const base = { quantidade: 1, salarioMensal: Dinheiro.de('7500') };
    const r2027 = calcularCustoPosicao({ ...base, mesInicio: 12, mesSaida: 12 }, p2027);
    const r2028 = calcularCustoPosicao({ ...base, mesInicio: 1, mesSaida: 1 }, p2028);
    if (!r2027.ok || !r2028.ok) throw new Error('motor');
    expect(r2027.valor.total.paraString()).not.toBe(r2028.valor.total.paraString());
    expect(e.avisos).toEqual([]);
    expect(e.custoMensal!.paraString()).toBe(r2027.valor.total.paraString());
    expect(e.custoPeriodo!.paraString()).toBe(r2027.valor.total.somar(r2028.valor.total).paraString());
  });

  it('quem só consulta não recebe custo nem avisos (D-P20-5); quem não vê a unidade não vê o bloco (RLS)', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await incluir(p.id, { metaId: m.id });
    const [b] = await listarEmpregados(await ctx(orcamentista, ['orc.empregados:consultar']), { proposta: p.numero }, comDeps());
    expect(b!.veCusto).toBe(false);
    expect(b!.grupos[0]!.empregados[0]).toMatchObject({ custoMensal: null, custoPeriodo: null, avisos: [] });
    expect(await listarEmpregados(await ctx(outro), { proposta: p.numero }, comDeps())).toEqual([]);
  });

  it('filtro por meta: só os grupos da meta; sem nenhum, a proposta sai', async () => {
    const p = await proposta();
    const m1 = await meta(p.id, 'M1');
    const m2 = await meta(p.id, 'M2');
    await incluir(p.id, { metaId: m1.id });
    await incluir(p.id, { metaId: m2.id });
    const [b] = await listarEmpregados(await ctx(), { proposta: p.numero, meta: 'M2' }, comDeps());
    expect(b!.grupos.map((g) => g.metaNumero)).toEqual(['M2']);
    expect(await listarEmpregados(await ctx(), { proposta: p.numero, meta: 'nada' }, comDeps())).toEqual([]);
  });

  it('cargos do formulário: os ativos com Fonte Ativa, sem salário; quem só consulta é recusado', async () => {
    const cargos = await cargosParaEmpregado(await ctx(), comDeps());
    expect(cargos.map((c) => c.codigo)).toEqual(['C001', 'C002']);
    expect(JSON.stringify(cargos)).not.toContain('7500');
    await expect(cargosParaEmpregado(await ctx(orcamentista, ['orc.empregados:consultar']), comDeps())).rejects.toThrow();
  });
});

describe('alterarEmpregado e excluirEmpregado (UC03.26, UC03.27)', () => {
  it('trocar o cargo herda a nova Fonte Ativa; manter o cargo guarda o salário gravado (REQ_EMP_004)', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const e = await incluir(p.id, { metaId: m.id, nome: 'Ana' });
    const outroSalario = cargosExemplo().map((c) => (c.id === C001 ? { ...c, salarioFonteAtiva: Dinheiro.de('9000') } : c));
    const r = await alterarEmpregado(await ctx(), { id: e.id, versao: 0, versaoCapa: 2, ...empregado({ nome: 'Ana Maria', dependentes: '3' }) }, comDeps(outroSalario));
    expect(r).toEqual({ ok: true, valor: { ordem: 1, nome: 'Ana Maria' } });
    const mantido = await migrator.empregadoProposta.findUniqueOrThrow({ where: { id: e.id } });
    expect(mantido).toMatchObject({ nome: 'Ana Maria', dependentes: 3, versao: 1 });
    expect(mantido.salarioMensal.toString()).toBe('7500');
    expect(await alterarEmpregado(await ctx(), { id: e.id, versao: 1, versaoCapa: 3, ...empregado({ cargoId: C002 }) }, comDeps())).toMatchObject({ ok: true });
    const trocado = await migrator.empregadoProposta.findUniqueOrThrow({ where: { id: e.id } });
    expect(trocado).toMatchObject({ cargoId: C002, nome: null });
    expect(trocado.salarioMensal.toString()).toBe('4200');
    const hs = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.empregados', registroId: e.id, tipoOperacao: 'ALTERACAO' }, orderBy: { id: 'asc' } });
    expect(hs[0]).toMatchObject({ antes: { nome: 'Ana', dependentes: 1 }, depois: { nome: 'Ana Maria', dependentes: 3, ordem: 1, meta: 'M1' } });
  });

  it('a meta e a ordem não mudam no alterar (blindadas); versão velha do empregado → ALTERADO_POR_OUTRO sem subir a capa', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const e = await incluir(p.id, { metaId: m.id });
    await expect(alterarEmpregado(await ctx(), { id: e.id, versao: 0, versaoCapa: 2, metaId: m.id, ...empregado() }, comDeps())).rejects.toThrow(ErroDominio);
    expect(await alterarEmpregado(await ctx(), { id: e.id, versao: 7, versaoCapa: 2, ...empregado() }, comDeps())).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    expect(await versaoCapa(p.id)).toBe(2);
  });

  it('exclui com Histórico; de quem não vê ou de versão anterior: recusado', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const e = await incluir(p.id, { metaId: m.id, nome: 'Ana' });
    expect(await excluirEmpregado(await ctx(outro), { id: e.id, versao: 0, versaoCapa: 2 }, comDeps())).toEqual(erroGeral(M.EMPREGADO_INEXISTENTE));
    expect(await excluirEmpregado(await ctx(), { id: e.id, versao: 0, versaoCapa: 2 }, comDeps())).toEqual({ ok: true, valor: { ordem: 1, nome: 'Ana' } });
    expect(await migrator.empregadoProposta.count({ where: { id: e.id } })).toBe(0);
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.empregados', registroId: e.id, tipoOperacao: 'EXCLUSAO' } });
    expect(h).toMatchObject({ antes: { nome: 'Ana', ordem: 1 } });

    const e2 = await incluir(p.id, { metaId: m.id });
    expect(await novaVersaoProposta(await ctx(), { id: p.id, versao: 4 }, comDeps())).toMatchObject({ ok: true });
    expect(await excluirEmpregado(await ctx(), { id: e2.id, versao: 0, versaoCapa: 5 }, comDeps())).toEqual(erroGeral(M.EMPREGADO_VERSAO_IMUTAVEL));
  });

  it('meta com empregado ligado não sai (FK RESTRICT, RN0136)', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await incluir(p.id, { metaId: m.id });
    expect(await excluirMeta(await ctx(), { id: m.id, versao: 0, versaoCapa: 2 }, comDeps())).toEqual(erroGeral(M.META_EXCLUSAO_VINCULADA));
  });
});

describe('quantitativos (UC03.20 a UC03.23)', () => {
  it('as quantidades são contadas dos empregados que cruzam o período, por categoria (RN0457); total da meta e geral', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    await incluir(p.id, { metaId: m.id, inicio: '2027-01', fim: '2027-06' });
    await incluir(p.id, { metaId: m.id, inicio: '2027-06', fim: '2027-12' });
    await incluir(p.id, { metaId: m.id, categoria: 'JOVEM_APRENDIZ', inicio: '2027-07', fim: '2027-12' });
    const capa = await versaoCapa(p.id);
    expect(await incluirQtde(await ctx(), { propostaId: p.id, versaoCapa: capa, metaId: m.id, inicio: '2027-01', fim: '2027-06', documento: 'AP-1' }, comDeps())).toEqual({
      ok: true,
      valor: { documento: 'AP-1' },
    });
    expect(
      await incluirQtde(await ctx(), { propostaId: p.id, versaoCapa: capa + 1, metaId: m.id, inicio: '2027-07', fim: '2027-12', documento: 'AP-2' }, comDeps()),
    ).toMatchObject({ ok: true });
    const [b] = await listarQtdes(await ctx(), { proposta: p.numero }, comDeps());
    const [g] = b!.grupos;
    expect(g!.qtdes.map((q) => [q.documento, q.quantidades])).toEqual([
      ['AP-1', { EMPREGADO: 2, ESTAGIARIO: 0, JOVEM_APRENDIZ: 0 }],
      ['AP-2', { EMPREGADO: 1, ESTAGIARIO: 0, JOVEM_APRENDIZ: 1 }],
    ]);
    expect(g!.totais).toEqual({ EMPREGADO: 3, ESTAGIARIO: 0, JOVEM_APRENDIZ: 1 });
    expect(b!.totais).toEqual({ EMPREGADO: 3, ESTAGIARIO: 0, JOVEM_APRENDIZ: 1 });
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.qtde_empregados', tipoOperacao: 'INSERCAO', descricao: { contains: 'AP-1' } } });
    expect(h).toMatchObject({ depois: { documento: 'AP-1', meta: 'M1', inicio: '2027-01', fim: '2027-06', EMPREGADO: 2 } });
  });

  it('sobreposição na mesma meta recusada (RN0155); em outra meta, aceita; alterar e excluir', async () => {
    const p = await proposta();
    const m1 = await meta(p.id, 'M1');
    const m2 = await meta(p.id, 'M2');
    const capa = () => versaoCapa(p.id);
    const corpo = async (extra: Record<string, unknown>) => ({ propostaId: p.id, versaoCapa: await capa(), metaId: m1.id, inicio: '2027-01', fim: '2027-06', documento: 'AP-1', ...extra });
    expect(await incluirQtde(await ctx(), await corpo({}), comDeps())).toMatchObject({ ok: true });
    expect(await incluirQtde(await ctx(), await corpo({ inicio: '2027-06', fim: '2027-08', documento: 'AP-2' }), comDeps())).toEqual(
      erroCampo('inicio', M.QTDE_SOBREPOSTA('AP-1')),
    );
    expect(await incluirQtde(await ctx(), await corpo({ metaId: m2.id, documento: 'AP-3' }), comDeps())).toMatchObject({ ok: true });
    const q = await migrator.qtdeEmpregadoProposta.findFirstOrThrow({ where: { documento: 'AP-1', versaoProposta: { propostaId: p.id } } });
    expect(await alterarQtde(await ctx(), { id: q.id, versao: 0, versaoCapa: await capa(), inicio: '2027-02', fim: '2027-05', documento: 'AP-1A' }, comDeps())).toEqual({
      ok: true,
      valor: { documento: 'AP-1A' },
    });
    expect(await excluirQtde(await ctx(), { id: q.id, versao: 1, versaoCapa: await capa() }, comDeps())).toEqual({ ok: true, valor: { documento: 'AP-1A' } });
    expect(await migrator.qtdeEmpregadoProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(1);
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_APROVACAO' } });
    const outra = await migrator.qtdeEmpregadoProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id } } });
    expect(await excluirQtde(await ctx(), { id: outra.id, versao: 0, versaoCapa: await capa() }, comDeps())).toEqual(erroGeral(M.QTDE_VERSAO_IMUTAVEL));
  });
});

describe('cópia (RN_DUP_003, D-P20-8)', () => {
  it('a nova versão e a duplicação copiam empregados e quantitativos, com ids novos, a mesma ordem e a meta de mesmo número', async () => {
    const p = await proposta();
    const m = await meta(p.id);
    const e = await incluir(p.id, { metaId: m.id, nome: 'Ana' });
    await incluirQtde(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), metaId: m.id, inicio: '2027-01', fim: '2027-12', documento: 'AP-1' }, comDeps());
    expect(await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps())).toMatchObject({ ok: true });
    const v2 = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: p.id, numero: 2 }, include: { metas: true, empregados: true, qtdes: true } });
    expect(v2.empregados.map((x) => [x.nome, x.ordem, x.metaId])).toEqual([['Ana', 1, v2.metas[0]!.id]]);
    expect(v2.empregados[0]!.id).not.toBe(e.id);
    expect(v2.empregados[0]!.salarioMensal.toString()).toBe('7500');
    expect(v2.qtdes.map((x) => [x.documento, x.metaId])).toEqual([['AP-1', v2.metas[0]!.id]]);

    const d = await duplicarProposta(await ctx(), { origemId: p.id, versaoOrigem: await versaoCapa(p.id), numero: `TP-D${++seq}`, cc: '9.2' }, comDeps());
    if (!d.ok) throw new Error(JSON.stringify(d.erros));
    const nova = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: d.valor.id }, include: { metas: true, empregados: true, qtdes: true } });
    expect(nova.empregados.map((x) => [x.nome, x.unidadeId, x.metaId])).toEqual([['Ana', d.valor.unidadeId, nova.metas[0]!.id]]);
    expect(nova.qtdes).toHaveLength(1);
  });

  it('duplicação com outra vigência só copia o que cabe nela; com outra categoria, não copia o pessoal (revisão 12.12)', async () => {
    const p = await proposta({ fim: '2028-12-31' });
    const m = await meta(p.id);
    await incluir(p.id, { metaId: m.id, nome: 'Em 2027', inicio: '2027-01', fim: '2027-12' });
    await incluir(p.id, { metaId: m.id, nome: 'Em 2028', inicio: '2028-01', fim: '2028-06' });
    const duplicar = async (extra: Record<string, unknown>) => {
      await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE codigo LIKE 'TP-D%'`;
      const d = await duplicarProposta(
        await ctx(),
        { origemId: p.id, versaoOrigem: await versaoCapa(p.id), numero: `TP-D${++seq}`, cc: '9.2', ...extra },
        comDeps(),
      );
      if (!d.ok) throw new Error(JSON.stringify(d.erros));
      return migrator.empregadoProposta.findMany({ where: { versaoProposta: { propostaId: d.valor.id } } });
    };
    expect((await duplicar({ inicio: '2028-01-01', fim: '2028-12-31' })).map((e) => e.nome)).toEqual(['Em 2028']);
    expect(await duplicar({ categoria: 'CONSOLIDADA' })).toEqual([]);
  });
});
