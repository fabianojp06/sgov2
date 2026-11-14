import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { distribuirIgual, montarCronograma } from './cronograma';

const d = (v: string) => Dinheiro.de(v);
const meses = (inicio: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const [a, m] = inicio.split('-').map(Number) as [number, number];
    const t = a * 12 + (m - 1) + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  });

describe('distribuirIgual (D-P25-2, Review Focus 2)', () => {
  it('7 meses: parcelas iguais e o resto no último; a soma é exata', () => {
    const p = distribuirIgual(d('100.00'), 7);
    expect(p.map((x) => x.paraString())).toEqual(['14.29', '14.29', '14.29', '14.29', '14.29', '14.29', '14.26']);
    expect(Dinheiro.somarTodos(p).paraString()).toBe('100.00');
  });

  it('a soma bate de 1 a 60 meses com valores quebrados', () => {
    for (let n = 1; n <= 60; n++) {
      for (const v of ['0.01', '1.00', '999999.99', '12345.67']) expect(Dinheiro.somarTodos(distribuirIgual(d(v), n)).paraString()).toBe(d(v).paraString());
    }
    expect(distribuirIgual(d('5.00'), 0)).toEqual([]);
  });
});

describe('montarCronograma (RN0251 a RN0254, Review Focus 3 e 5)', () => {
  it('de 03/2027 a 05/2028: descrições, acumulado, %, repasse no 12º e no último mês, fechamento de cada ano', () => {
    const comp = meses('2027-03', 15);
    const porMes = new Map(comp.map((c) => [c, d('100.00')]));
    const l = montarCronograma(comp, porMes, d('1500.00'));
    const meses2027 = l.filter((x) => x.tipo === 'MES' && x.competencia!.startsWith('2027'));
    expect(meses2027).toHaveLength(10);
    expect(l[0]).toMatchObject({ descricao: 'Parcela 1 – 03/2027', repasseCiclo: null });
    expect(l[0]!.percentualAcumulado?.paraString()).toBe('6.6700');
    const total2027 = l.find((x) => x.descricao === 'Total de 2027')!;
    expect([total2027.desembolso.paraString(), total2027.acumulado.paraString()]).toEqual(['1000.00', '1000.00']);
    expect(l.indexOf(total2027)).toBe(10);
    const p12 = l.find((x) => x.descricao === 'Parcela 12 – 02/2028')!;
    expect(p12.repasseCiclo?.paraString()).toBe('1200.00');
    const ultima = l.find((x) => x.descricao === 'Parcela 15 – 05/2028')!;
    expect([ultima.repasseCiclo?.paraString(), ultima.acumulado.paraString(), ultima.percentualAcumulado?.paraString()]).toEqual(['300.00', '1500.00', '100.0000']);
    expect(l.at(-1)).toMatchObject({ tipo: 'ANO', descricao: 'Total de 2028' });
    expect(l.at(-1)!.desembolso.paraString()).toBe('500.00');
  });

  it('sem Valor Global, o % é nulo; mês sem lançamento é zero; 60 meses montam rápido', () => {
    const comp = meses('2027-01', 60);
    const t0 = performance.now();
    const l = montarCronograma(comp, new Map([['2027-02', d('10.00')]]), Dinheiro.zero());
    expect(performance.now() - t0).toBeLessThan(200);
    expect(l.filter((x) => x.tipo === 'MES')).toHaveLength(60);
    expect(l.filter((x) => x.tipo === 'ANO')).toHaveLength(5);
    expect(l[0]).toMatchObject({ percentualAcumulado: null });
    expect(l[0]!.desembolso.ehZero()).toBe(true);
  });
});
