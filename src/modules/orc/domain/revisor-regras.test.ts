import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import {
  filtrarAchados,
  normalizarJustificativa,
  regraAumento,
  regraDesejaveis,
  regraDuplicados,
  regraForaDaFaixa,
  regraSemBeneficio,
  type Achado,
  type AlcanceRevisao,
  type PacoteRegra,
  type PosicaoRegra,
  type TotalPar,
} from './revisor-regras';

// Regras do revisor (US-064; plano do P14, D-P14-7), com os valores de limite do plano.
const d = (v: string) => Dinheiro.de(v);
const pacote = (id: string, extra: Partial<PacoteRegra> = {}): PacoteRegra => ({
  id,
  cc: '4.3.0',
  conta: '4.1.1.5.005',
  prioridade: 'IMPORTANTE',
  anual: d('1200.00'),
  justificativa: 'Reposição de material de escritório',
  ...extra,
});
const par = (total: string, cc = '4.3.0', conta = '4.1.1.5.005'): TotalPar => ({ cc, conta, total: d(total) });

describe('R1: pacote duplicado', () => {
  it('justificativas que diferem só em acento, caixa e espaços: 1 achado com os 2 ids', () => {
    const r = regraDuplicados([pacote('a'), pacote('b', { justificativa: '  REPOSIÇÃO de   material de escritorio ' }), pacote('c', { cc: '4.4' })]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'DUPLICADO', pacotes: ['a', 'b'], par: null, posicoes: [], salario: false });
    expect(r[0]!.texto).toContain('CC 4.3.0, conta 4.1.1.5.005');
  });

  it('anual diferente, conta diferente ou texto diferente: nenhum', () => {
    expect(regraDuplicados([pacote('a'), pacote('b', { anual: d('1200.01') })])).toEqual([]);
    expect(regraDuplicados([pacote('a'), pacote('b', { conta: '4.1.1.5.006' })])).toEqual([]);
    expect(regraDuplicados([pacote('a'), pacote('b', { justificativa: 'Reposição de material de limpeza' })])).toEqual([]);
  });

  it('a normalização tira acentos, caixa e espaços repetidos', () => {
    expect(normalizarJustificativa(' Ação  ÚNICA\n\tde teste ')).toBe('acao unica de teste');
  });
});

describe('R2: aumento sobre o ano anterior', () => {
  it('anterior 10.000,00 e atual 25.000,00: achado (+150 %, +15.000)', () => {
    const r = regraAumento([par('25000.00')], [par('10000.00')]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'AUMENTO_ANO_ANTERIOR', par: { cc: '4.3.0', conta: '4.1.1.5.005' }, pacotes: [] });
    expect(r[0]!.texto).toContain('150,00%');
    expect(r[0]!.texto).toMatch(/\+R\$\s15\.000,00/);
  });

  it('anterior 100.000,00 e atual 149.999,99: nenhum (menos de 50 %)', () => {
    expect(regraAumento([par('149999.99')], [par('100000.00')])).toEqual([]);
    // Exatamente 50 %: não passa ("mais de 50 %").
    expect(regraAumento([par('150000.00')], [par('100000.00')])).toEqual([]);
    expect(regraAumento([par('150000.01')], [par('100000.00')])).toHaveLength(1);
  });

  it('sem arredondamento no limite: anterior 20.000,01 e atual 30.000,02 passa de 50 %', () => {
    // 20.000,01 × 1,5 = 30.000,015, que arredondado viraria 30.000,02 e esconderia o achado.
    expect(regraAumento([par('30000.02')], [par('20000.01')])).toHaveLength(1);
    expect(regraAumento([par('30000.01')], [par('20000.01')])).toEqual([]);
  });

  it('anterior 1.000,00 e atual 9.000,00: nenhum (diferença menor que 10.000)', () => {
    expect(regraAumento([par('9000.00')], [par('1000.00')])).toEqual([]);
    // Diferença de exatamente 10.000,00: passa.
    expect(regraAumento([par('11000.00')], [par('1000.00')])).toHaveLength(1);
  });

  it('soma as linhas do mesmo par e ignora par novo (sem base no ano anterior)', () => {
    expect(regraAumento([par('15000.00'), par('10000.00')], [par('5000.00'), par('5000.00')])).toHaveLength(1);
    expect(regraAumento([par('900000.00', '4.4')], [par('10000.00')])).toEqual([]);
  });
});

describe('R3: desejáveis acima do teto', () => {
  it('orçado acima do teto com 2 desejáveis: achado com os 2, do maior anual para o menor', () => {
    const r = regraDesejaveis(d('120000.01'), d('120000.00'), [
      pacote('menor', { prioridade: 'DESEJAVEL', anual: d('100.00') }),
      pacote('essencial', { prioridade: 'ESSENCIAL', anual: d('99999.00') }),
      pacote('maior', { prioridade: 'DESEJAVEL', anual: d('5000.00') }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'DESEJAVEIS_ACIMA_DO_TETO', pacotes: ['maior', 'menor'] });
    expect(r[0]!.texto).toMatch(/em R\$\s0,01/);
  });

  it('orçado dentro do teto (ou igual a ele): nenhum', () => {
    const desejavel = pacote('x', { prioridade: 'DESEJAVEL' });
    expect(regraDesejaveis(d('100.00'), d('120.00'), [desejavel])).toEqual([]);
    expect(regraDesejaveis(d('120.00'), d('120.00'), [desejavel])).toEqual([]);
  });
});

describe('filtro dos achados por quem vê', () => {
  const link = (tipo: 'pacote' | 'posicao' | 'par', pessoal?: boolean) => ({ rotulo: tipo, href: '/orc/x', tipo, ...(pessoal === undefined ? {} : { pessoal }) });
  const achados: Achado[] = [
    { origem: 'REGRA', tipo: 'DUPLICADO', texto: 'pacotes', links: [link('pacote'), link('pacote')] },
    { origem: 'IA', tipo: 'OUTRO', texto: 'posição', links: [link('posicao')] },
    { origem: 'IA', tipo: 'OUTRO', texto: 'os dois', links: [link('pacote'), link('posicao')] },
    { origem: 'REGRA', tipo: 'AUMENTO_ANO_ANTERIOR', texto: 'par de pessoal', links: [link('par', true)] },
    { origem: 'REGRA', tipo: 'AUMENTO_ANO_ANTERIOR', texto: 'par sem pessoal', links: [link('par', false)] },
    { origem: 'REGRA', tipo: 'DESEJAVEIS_ACIMA_DO_TETO', texto: 'teto', links: [] },
  ];
  const textos = (a: AlcanceRevisao) => filtrarAchados(achados, a).map((x) => x.texto);

  it('tudo para quem vê tudo; sem pacotes, sem posições e sem salário, só o que não cita linha proibida', () => {
    expect(textos({ pacotes: true, posicoes: true, salario: true, salariosCargo: true })).toEqual(achados.map((a) => a.texto));
    expect(textos({ pacotes: false, posicoes: true, salario: true, salariosCargo: false })).toEqual(['posição', 'par de pessoal', 'par sem pessoal', 'teto']);
    expect(textos({ pacotes: true, posicoes: false, salario: false, salariosCargo: false })).toEqual(['pacotes', 'par sem pessoal', 'teto']);
  });

  it('link de posição com salário (R5): só com o salário da posição E o cad.salarios; o R4 só pede posições', () => {
    const comSalario: Achado[] = [
      { origem: 'REGRA', tipo: 'SALARIO_FORA_DA_FAIXA', texto: 'R5', links: [{ ...link('posicao'), salario: true }] },
      { origem: 'REGRA', tipo: 'POSICAO_SEM_BENEFICIO', texto: 'R4', links: [link('posicao'), link('posicao')] },
    ];
    const ver = (a: AlcanceRevisao) => filtrarAchados(comSalario, a).map((x) => x.texto);
    expect(ver({ pacotes: false, posicoes: true, salario: true, salariosCargo: true })).toEqual(['R5', 'R4']);
    expect(ver({ pacotes: false, posicoes: true, salario: true, salariosCargo: false })).toEqual(['R4']);
    expect(ver({ pacotes: false, posicoes: true, salario: false, salariosCargo: true })).toEqual(['R4']);
    expect(ver({ pacotes: false, posicoes: true, salario: false, salariosCargo: false })).toEqual(['R4']);
    expect(ver({ pacotes: true, posicoes: false, salario: true, salariosCargo: true })).toEqual([]);
  });
});

// Regras de pessoal (US-064; plano do P15, D-P15-4). C001: faixa 7.500,00 a 9.800,00.
const C001 = '00000000-0000-4000-8000-000000000001';
const C002 = '00000000-0000-4000-8000-000000000002';
const posicao = (id: string, extra: Partial<PosicaoRegra> = {}): PosicaoRegra => ({
  id,
  cc: '4.3.0',
  cargoId: C001,
  cargoNome: 'Analista de orçamento',
  salarioMensal: d('8000.00'),
  ...extra,
});

describe('R5: salário fora da faixa do cargo', () => {
  const faixas = new Map([[C001, { minimo: d('7500.00'), maximo: d('9800.00') }]]);

  it('igual ao mínimo ou ao máximo: dentro, nenhum achado', () => {
    expect(regraForaDaFaixa([posicao('a', { salarioMensal: d('7500.00') }), posicao('b', { salarioMensal: d('9800.00') })], faixas)).toEqual([]);
  });

  it('0,01 abaixo do mínimo: um achado "abaixo do mínimo", com salário e sem nenhum valor no texto', () => {
    const r = regraForaDaFaixa([posicao('a', { salarioMensal: d('7499.99') })], faixas);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'SALARIO_FORA_DA_FAIXA', posicoes: ['a'], pacotes: [], par: null, salario: true });
    expect(r[0]!.texto).toBe('CC 4.3.0, cargo Analista de orçamento: salário mensal abaixo do mínimo da faixa de mercado do cargo.');
    for (const v of ['7.499,99', '7499.99', '7.500,00', '7500', '9.800,00', '9800']) expect(r[0]!.texto).not.toContain(v);
  });

  it('0,01 acima do máximo: um achado "acima do máximo"', () => {
    const r = regraForaDaFaixa([posicao('a', { salarioMensal: d('9800.01') })], faixas);
    expect(r).toHaveLength(1);
    expect(r[0]!.texto).toContain('acima do máximo');
    expect(r[0]!.texto).not.toContain('9.800');
  });

  it('cargo sem faixa (nula ou fora do mapa): nenhum', () => {
    expect(regraForaDaFaixa([posicao('a', { salarioMensal: d('1.00') })], new Map([[C001, null]]))).toEqual([]);
    expect(regraForaDaFaixa([posicao('a', { salarioMensal: d('1.00'), cargoId: C002 })], faixas)).toEqual([]);
  });

  it('um achado por posição, em ordem de CC', () => {
    const r = regraForaDaFaixa([posicao('b', { cc: '4.4', salarioMensal: d('1.00') }), posicao('a', { cc: '4.3.0', salarioMensal: d('99999.00') })], faixas);
    expect(r.map((x) => x.posicoes)).toEqual([['a'], ['b']]);
  });
});

describe('R4: posição sem benefício', () => {
  it('duas posições do C001 e uma do C002, com o C001 sem benefício: um achado com as 2 do C001, em ordem de CC', () => {
    const r = regraSemBeneficio(
      [posicao('x', { cc: '4.4' }), posicao('y', { cargoId: C002, cargoNome: 'Técnico de manutenção' }), posicao('w', { cc: '4.3.0' })],
      new Set([C001]),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'POSICAO_SEM_BENEFICIO', posicoes: ['w', 'x'], pacotes: [], par: null, salario: false });
    expect(r[0]!.texto).toBe('Cargo Analista de orçamento: 2 posições sem benefício calculável no exercício.');
  });

  it('uma posição: singular; conjunto vazio: nenhum achado', () => {
    expect(regraSemBeneficio([posicao('x')], new Set([C001]))[0]!.texto).toContain(': 1 posição sem benefício');
    expect(regraSemBeneficio([posicao('x')], new Set())).toEqual([]);
  });
});
