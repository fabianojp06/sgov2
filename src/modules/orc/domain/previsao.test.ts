import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { preverConta } from './previsao';

const MESES = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const d = (v: string) => Dinheiro.de(v);
const doze = (v: string) => MESES.map(() => d(v));
const ate = (n: number, v: string) => MESES.map((_, i) => (i < n ? d(v) : Dinheiro.zero()));

describe('preverConta (D-P34-1)', () => {
  it('no ritmo do orçado: projetado = orçado, sem risco', () => {
    const p = preverConta(MESES, 5, { conta: 'c', orcado: doze('1000'), realizado: ate(6, '1000') });
    expect([p.projetadoAno.paraString(), p.tendencia?.paraString() ?? null, p.risco, p.mesEstouro]).toEqual(['12000.00', '100.00', false, null]);
  });

  it('gastando 20% acima: a tendência de 120% projeta 14.400,00 e o estouro em Nov', () => {
    const p = preverConta(MESES, 5, { conta: 'c', orcado: doze('1000'), realizado: ate(6, '1200') });
    // 6 × 1.200 + 6 × 1.200 = 14.400; o acumulado passa de 12.000 em Out (12.000) não, em Nov (13.200).
    expect([p.realizadoAteCorte.paraString(), p.projetadoAno.paraString(), p.desvio.paraString(), p.tendencia?.paraString() ?? null, p.risco, p.mesEstouro]).toEqual([
      '7200.00',
      '14400.00',
      '2400.00',
      '120.00',
      true,
      '2026-11',
    ]);
  });

  it('o estouro já acontecido aponta o mês em que o realizado passou do orçado do ano', () => {
    const orcado = MESES.map((_, i) => (i === 0 ? d('500') : Dinheiro.zero()));
    const realizado = MESES.map((_, i) => (i < 2 ? d('400') : Dinheiro.zero()));
    const p = preverConta(MESES, 1, { conta: 'c', orcado, realizado });
    expect([p.projetadoAno.paraString(), p.mesEstouro]).toEqual(['800.00', '2026-02']);
  });

  it('sem realizado (corte −1): a projeção é o orçado; sem orçado acumulado, a tendência é nula', () => {
    const p = preverConta(MESES, -1, { conta: 'c', orcado: doze('10'), realizado: doze('0') });
    expect([p.projetadoAno.paraString(), p.tendencia?.paraString() ?? null, p.risco]).toEqual(['120.00', null, false]);
  });

  it('realizado sem orçado: risco desde o primeiro mês com gasto', () => {
    const p = preverConta(MESES, 2, { conta: 'c', orcado: doze('0'), realizado: ate(3, '10') });
    expect([p.projetadoAno.paraString(), p.risco, p.mesEstouro, p.tendencia]).toEqual(['30.00', true, '2026-01', null]);
  });
});
