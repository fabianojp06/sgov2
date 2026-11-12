import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Competencia } from './competencia';
import { ErroDominio } from './erros';

describe('Competencia (RN0302)', () => {
  it('igual() compara ano e mês, não a referência', () => {
    expect(Competencia.de(2027, 3).igual(Competencia.parse('Mar/27'))).toBe(true);
    expect(Competencia.de(2027, 3).igual(Competencia.de(2027, 4))).toBe(false);
  });

  it('RN0302', () => {
    expect(Competencia.parse('Jun/22').formatar()).toBe('Jun/22');
    expect(Competencia.de(2026, 12).proxima().formatar()).toBe('Jan/27');
    expect(() => Competencia.parse('Jun/2022')).toThrow(ErroDominio);
  });

  it('aceita minúsculas e devolve ano e mês', () => {
    const c = Competencia.parse('fev/27');
    expect([c.ano, c.mes]).toEqual([2027, 2]);
    expect(c.formatar()).toBe('Fev/27');
  });

  // 'Jun/0022' e 'Jun/022': o regex aceita só 2 ou 4 dígitos; a faixa 2000–2099 não barra esses (#168).
  it.each(['Jun', 'Xyz/22', 'Jun/2', '13/22', ' Jun/22', 'Jun/22 ', 'Jun/0022', 'Jun/022'])('rejeita %j', (s) =>
    expect(() => Competencia.parse(s)).toThrow(ErroDominio));

  it.each([
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
    [1999, 1],
    [2100, 1],
  ])('rejeita de(%d, %d)', (ano, mes) => expect(() => Competencia.de(ano, mes)).toThrow(ErroDominio));

  it('compara por ano e mês', () => {
    expect(Competencia.de(2026, 12).comparar(Competencia.de(2027, 1))).toBe(-1);
    expect(Competencia.de(2027, 1).comparar(Competencia.parse('Jan/27'))).toBe(0);
    expect(Competencia.de(2027, 2).comparar(Competencia.de(2027, 1))).toBe(1);
  });

  it('formata todos os meses', () => {
    const meses = Array.from({ length: 12 }, (_, i) => Competencia.de(2027, i + 1).formatar().slice(0, 3));
    expect(meses).toEqual(['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']);
  });
});

describe('Competencia: propriedades e entrada hostil (revisão 12.12)', () => {
  const competencia = fc
    .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }))
    .map(([ano, mes]) => Competencia.de(ano, mes));

  it('parse(formatar(c)) devolve c', () =>
    fc.assert(
      fc.property(competencia, (c) => {
        expect(Competencia.parse(c.formatar()).comparar(c)).toBe(0);
      }),
    ));

  it('proxima é sempre maior', () =>
    fc.assert(
      fc.property(
        competencia.filter((c) => c.comparar(Competencia.de(2099, 12)) < 0),
        (c) => {
          expect(c.proxima().comparar(c)).toBe(1);
        },
      ),
    ));

  it('texto enorme é recusado sem copiar a entrada para o erro', () => {
    const enorme = 'J'.repeat(1_000_000);
    try {
      Competencia.parse(enorme);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDominio);
      expect(JSON.stringify(e).length + (e as Error).message.length).toBeLessThan(200);
    }
  });
});
