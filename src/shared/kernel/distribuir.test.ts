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
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (c) => {
        const anual = Dinheiro.de(new Decimal(c.toString()).div(100));
        expect(Dinheiro.somarTodos(distribuirEm12(anual)).paraString()).toBe(anual.paraString());
      }),
    ));
});
