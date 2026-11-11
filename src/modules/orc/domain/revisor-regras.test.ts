import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { normalizarJustificativa, regraAumento, regraDesejaveis, regraDuplicados, type PacoteRegra, type TotalPar } from './revisor-regras';

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
    expect(r[0]).toMatchObject({ tipo: 'DUPLICADO', pacotes: ['a', 'b'], par: null });
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
