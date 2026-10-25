import Decimal from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from './dinheiro';
import { distribuirEm12 } from './distribuir';

describe('distribuirEm12', () => {
  it('100,00 em 12', () => {
    const p = distribuirEm12(Dinheiro.de('100'));
    expect(p).toHaveLength(12);
    expect(p.slice(0, 11).every((x) => x.paraString() === '8.33')).toBe(true);
    expect(p[11]!.paraString()).toBe('8.37');
  });

  it('igual à planilha-modelo', () => {
    const p = distribuirEm12(Dinheiro.de('4368.87'));
    expect(p[0]!.paraString()).toBe('364.07');
    expect(p[11]!.paraString()).toBe('364.10');
  });

  it('propriedade: soma = anual', () =>
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n - 1n), max: 10n ** 15n - 1n }), (c) => {
        const anual = Dinheiro.de(new Decimal(c.toString()).div(100));
        expect(Dinheiro.somarTodos(distribuirEm12(anual)).paraString()).toBe(anual.paraString());
      }),
    ));
});

describe('distribuirEm12: casos de borda (revisão 12.12)', () => {
  it('valor negativo', () => {
    const p = distribuirEm12(Dinheiro.de('-100'));
    expect(p[0]!.paraString()).toBe('-8.33');
    expect(p[11]!.paraString()).toBe('-8.37');
  });

  // Igual à planilha-modelo (11 × ROUND(anual/12) e o resto em dezembro): em valores muito
  // pequenos, dezembro pode ficar com o sinal oposto. A soma sempre fecha com o anual.
  it('valor pequeno: dezembro absorve a diferença, mesmo com sinal oposto', () => {
    const p = distribuirEm12(Dinheiro.de('0.18'));
    expect(p[0]!.paraString()).toBe('0.02');
    expect(p[11]!.paraString()).toBe('-0.04');
  });

  it('nos limites de NUMERIC(15,2)', () => {
    const p = distribuirEm12(Dinheiro.de('9999999999999.99'));
    expect(p[0]!.paraString()).toBe('833333333333.33');
    expect(p[11]!.paraString()).toBe('833333333333.36');
  });
});
