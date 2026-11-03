import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { recalcularExercicio } from './calculo-linhas';
import { obterVisaoExercicio, type NoVisao } from './consolidacao';
import { resolverDeps, type DepsOrc } from './deps';

// Visão por centro de custo (US-058; plano do P6, Task 6), com os falsos do C1 e do C2.
// Árvore do falso: 4 → 4.3 → {4.3.0, 4.3.2 → {4.3.2.10, 4.3.2.11}}; 4 → 4.4.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2030;

const ctx = (): ContextoRequisicao => ({ usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(['orc.orcamento:consultar']) });
const s = (d: Dinheiro | null | undefined) => d?.paraString();

function marcarInativo(no: NoCentroCusto, classificacao: string): NoCentroCusto {
  return { ...no, ativo: no.classificacao === classificacao ? false : no.ativo, filhos: no.filhos.map((f) => marcarInativo(f, classificacao)) };
}

async function exercicioCalculado(extra: { ccOrfao?: string } = {}) {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  const pos = (cc: string, quantidade: number, salario: string, mesSaida: number) =>
    migrator.posicaoOrcada.create({ data: { exercicioId: e.id, cc, cargo: 'Analista', quantidade, salarioMensal: salario, mesInicio: 1, mesSaida, origem: 'IMPORTACAO' } });
  const pac = (cc: string, prioridade: string, quantidade: number, valor: string, ipca: boolean, distribuicao: string, mes: number | null) =>
    migrator.pacoteBaseZero.create({
      data: { exercicioId: e.id, cc, conta: '4.1.1.5.005', justificativa: 'Reposição de material', prioridade, quantidade, valorUnitario: valor, corrigirIpca: ipca, distribuicao, mesOcorrencia: mes, origem: 'IMPORTACAO' },
    });
  await pos('4.3.2.11', 2, '7500.00', 12); // 180.000,00 no falso do C2 (tudo em salário)
  await pos('4.4', 1, '5000.00', 6); // 30.000,00; sai em junho
  await pac('4.3.0', 'IMPORTANTE', 12, '350.00', true, 'MENSAL', null); // 4.389,00 (IPCA 4,5% do exemplo)
  await pac('4.4', 'ESSENCIAL', 1, '1000.00', false, 'PONTUAL', 7); // 1.000,00 em julho
  if (extra.ccOrfao) await pos(extra.ccOrfao, 1, '1000.00', 12);
  const custo = custoPessoalFalso([premissasExemplo(a)]);
  const base: Partial<DepsOrc> = { cliente: app, estrutura: estruturaFinanceiraFalsa(), custoPessoal: custo, obterEscopo: async () => null };
  await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(base)));
  return { ...e, ano: a, deps: (d: Partial<DepsOrc> = {}) => ({ ...base, ...d }) };
}

const achar = (nos: readonly NoVisao[], cc: string): NoVisao | undefined => {
  for (const n of nos) {
    if (n.cc === cc) return n;
    const f = achar(n.filhos, cc);
    if (f) return f;
  }
  return undefined;
};

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('obterVisaoExercicio: árvore e indicadores', () => {
  it('sintéticos somados (RN_TOT_01), % do escopo, soma dos analíticos = total (§10.2 item 6)', async () => {
    const e = await exercicioCalculado();
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps()))!;
    expect(v.arvore.map((n) => n.cc)).toEqual(['4']);
    expect(s(achar(v.arvore, '4.3.2')?.total)).toBe('180000.00');
    expect(s(achar(v.arvore, '4.3')?.total)).toBe('184389.00');
    expect(s(achar(v.arvore, '4.3')?.pessoal)).toBe('180000.00');
    expect(s(achar(v.arvore, '4.3')?.baseZero)).toBe('4389.00');
    expect(s(achar(v.arvore, '4.4')?.total)).toBe('31000.00');
    expect(s(achar(v.arvore, '4')?.total)).toBe('215389.00');
    expect(Number(achar(v.arvore, '4')?.percentualDoEscopo?.paraString())).toBe(100);
    expect(Number(achar(v.arvore, '4.4')?.percentualDoEscopo?.paraString())).toBeCloseTo(14.39, 1);
    expect(achar(v.arvore, '4.3.2.11')?.codigoReduzido).toBe('14.370');
    const analiticos = ['4.3.0', '4.3.2.10', '4.3.2.11', '4.4'].map((cc) => achar(v.arvore, cc)!.total);
    expect(Dinheiro.somarTodos(analiticos).paraString()).toBe(v.indicadores.orcamentoAno.paraString());
  });

  it('indicadores: orçamento, pessoal e %, pacotes, empregados em dezembro (D-P6-7) e prioridades', async () => {
    const e = await exercicioCalculado();
    const { indicadores: i } = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps()))!;
    expect(s(i.orcamentoAno)).toBe('215389.00');
    expect(s(i.pessoal)).toBe('210000.00');
    expect(i.percentualPessoal).not.toBeNull();
    expect(i.pacotes).toBe(2);
    expect(i.empregadosDezembro).toBe(2);
    expect(s(i.porPrioridade.IMPORTANTE)).toBe('4389.00');
    expect(s(i.porPrioridade.ESSENCIAL)).toBe('1000.00');
    expect(s(i.porPrioridade.DESEJAVEL)).toBe('0.00');
  });

  it('ano inexistente: o mais recente', async () => {
    const e = await exercicioCalculado();
    const maior = await migrator.orcamentoExercicio.aggregate({ _max: { ano: true } });
    expect((await obterVisaoExercicio(ctx(), 1999, null, e.deps()))!.exercicio.ano).toBe(maior._max.ano);
  });
});

describe('obterVisaoExercicio: detalhe', () => {
  it('CC sintético: série mês a mês por origem e linhas CC × conta agrupadas, com a origem', async () => {
    const e = await exercicioCalculado();
    const { detalhe } = (await obterVisaoExercicio(ctx(), e.ano, '4.3', e.deps()))!;
    expect(detalhe?.descricao).toBe('Diretoria Administrativa Financeira');
    expect(detalhe?.serie.pessoal.map(s)).toEqual(Array(12).fill('15000.00'));
    expect(detalhe?.serie.total.map(s)[0]).toBe('15365.75');
    expect(detalhe?.linhas.map((l) => [l.origem, l.conta, s(l.total)])).toEqual([
      ['BASE_ZERO', '4.1.1.5.005', '4389.00'],
      ['PESSOAL', '4.1.1.1.001', '180000.00'],
    ]);
  });

  it('CC inexistente: orc.cc_inexistente', async () => {
    const e = await exercicioCalculado();
    await expect(obterVisaoExercicio(ctx(), e.ano, '9.9', e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.cc_inexistente' }));
  });
});

describe('obterVisaoExercicio: escopo (C25, Review Focus 5)', () => {
  it('gestor com escopo 4.3: só a subárvore e os indicadores dela; 4.4 negado; DIREX vê tudo', async () => {
    const e = await exercicioCalculado();
    const gestor = e.deps({ obterEscopo: async () => '4.3' });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, gestor))!;
    expect(v.escopo.tipo).toBe('SUBARVORE');
    expect(v.arvore.map((n) => n.cc)).toEqual(['4.3']);
    expect(achar(v.arvore, '4.4')).toBeUndefined();
    expect(s(v.indicadores.orcamentoAno)).toBe('184389.00');
    expect(v.indicadores.pacotes).toBe(1);
    expect(v.indicadores.empregadosDezembro).toBe(2);
    await expect(obterVisaoExercicio(ctx(), e.ano, '4.4', gestor)).rejects.toBeInstanceOf(ErroPermissao);
    expect((await obterVisaoExercicio(ctx(), e.ano, '4.4', e.deps()))!.detalhe?.cc).toBe('4.4');
  });

  it('gestor de 4.4: os indicadores filtram pacotes, empregados, pessoal e prioridades', async () => {
    const e = await exercicioCalculado();
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ obterEscopo: async () => '4.4' })))!;
    expect(v.arvore.map((n) => n.cc)).toEqual(['4.4']);
    expect(v.indicadores.empregadosDezembro).toBe(0); // a posição de 4.4 sai em junho; a de 4.3.2.11 não conta
    expect(v.indicadores.pacotes).toBe(1);
    expect(s(v.indicadores.pessoal)).toBe('30000.00');
    expect(s(v.indicadores.porPrioridade.IMPORTANTE)).toBe('0.00');
    expect(s(v.indicadores.porPrioridade.ESSENCIAL)).toBe('1000.00');
  });

  it('R16: raiz do escopo inativa → nada aparece (o índice do C1 não a conhece)', async () => {
    const e = await exercicioCalculado();
    const inativa = estruturaFinanceiraFalsa({ centrosCusto: CENTROS_CUSTO_EXEMPLO.map((n) => marcarInativo(n, '4.3')) });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ estrutura: inativa, obterEscopo: async () => '4.3' })))!;
    expect(v.arvore).toEqual([]);
    expect(s(v.indicadores.orcamentoAno)).toBe('0.00');
    expect(v.indicadores.pacotes).toBe(0);
    expect(v.indicadores.empregadosDezembro).toBe(0);
    await expect(obterVisaoExercicio(ctx(), e.ano, '4.3.2.11', e.deps({ estrutura: inativa, obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('R16: CC de escopo fora da estrutura, mesmo com linhas nele → nada aparece', async () => {
    const e = await exercicioCalculado({ ccOrfao: '9.9.9' });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ obterEscopo: async () => '9.9.9' })))!;
    expect(v.arvore).toEqual([]);
    expect(s(v.indicadores.orcamentoAno)).toBe('0.00');
    expect(v.indicadores.empregadosDezembro).toBe(0);
  });

  it('escopo com raiz inexistente: árvore vazia e zero, nunca tudo (R16)', async () => {
    const e = await exercicioCalculado();
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ obterEscopo: async () => '9.9' })))!;
    expect(v.arvore).toEqual([]);
    expect(s(v.indicadores.orcamentoAno)).toBe('0.00');
    expect(v.indicadores.pacotes).toBe(0);
  });
});

describe('obterVisaoExercicio: inativos, CC fora da estrutura e premissas', () => {
  it('CC inativado depois da importação (R2): nó inativo, valor somado no pai, sem NO_INEXISTENTE', async () => {
    const e = await exercicioCalculado();
    const inativa = estruturaFinanceiraFalsa({ centrosCusto: CENTROS_CUSTO_EXEMPLO.map((n) => marcarInativo(n, '4.4')) });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ estrutura: inativa })))!;
    expect(achar(v.arvore, '4.4')).toMatchObject({ inativo: true });
    expect(s(achar(v.arvore, '4')?.total)).toBe('215389.00');
  });

  it('inativo herdado: filho de sintético inativo aparece inativo na visão total', async () => {
    const e = await exercicioCalculado();
    const inativa = estruturaFinanceiraFalsa({ centrosCusto: CENTROS_CUSTO_EXEMPLO.map((n) => marcarInativo(n, '4.3')) });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ estrutura: inativa })))!;
    expect(achar(v.arvore, '4.3')?.inativo).toBe(true);
    expect(achar(v.arvore, '4.3.2.11')?.inativo).toBe(true);
    expect(achar(v.arvore, '4.4')?.inativo).toBe(false);
  });

  it('CC que nem a árvore conhece: nó próprio marcado fora da estrutura', async () => {
    const e = await exercicioCalculado({ ccOrfao: '9.9.9' });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps()))!;
    expect(v.arvore.find((n) => n.cc === '9.9.9')).toMatchObject({ descricao: '(CC fora da estrutura)', inativo: true });
  });

  it('Review Focus 4: premissas com outra versão → aviso; avisos do C2 aparecem; C2 indisponível → aviso', async () => {
    const e = await exercicioCalculado();
    const outra = custoPessoalFalso([{ ...premissasExemplo(e.ano), versao: 9, avisos: ['Benefícios sem valor.'] }]);
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ custoPessoal: outra })))!;
    expect(v.exercicio.premissasDesatualizadas).toBe(true);
    const semSemaforo = (avisos: readonly string[]) => avisos.filter((a) => !a.includes('semáforo'));
    expect(semSemaforo(v.avisos)).toEqual(['As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.', 'Benefícios sem valor.']);
    const indisponivel = {
      ...outra,
      obterPremissasExercicio: async () => {
        throw new ErroDominio('cad.custo_pessoal_indisponivel', 'x');
      },
    };
    expect(semSemaforo((await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ custoPessoal: indisponivel })))!.avisos)).toEqual([
      'As premissas do exercício ainda não estão disponíveis.',
    ]);
    expect(semSemaforo((await obterVisaoExercicio(ctx(), e.ano, null, e.deps()))!.avisos)).toEqual([]);
  });

  it('sem orc.orcamento:consultar: ErroPermissao', async () => {
    const e = await exercicioCalculado();
    await expect(obterVisaoExercicio({ ...ctx(), permissoes: new Set() }, e.ano, null, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});
