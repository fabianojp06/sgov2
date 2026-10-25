import Decimal from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from './dinheiro';
import { ErroDominio } from './erros';
import { Percentual } from './percentual';

describe('Percentual', () => {
  it.each([
    ['569413.56', '704831.00', '80.79'],
    ['713183.14', '540656.00', '131.91'],
    ['1282596.70', '1245487.00', '102.98'],
  ])('RN_OXR_010 %s/%s = %s%%', (n, d, p) =>
    expect(Percentual.razao(Dinheiro.de(n), Dinheiro.de(d))?.paraString()).toBe(p));

  it('RN_OXR_012 orçado zero → null', () => expect(Percentual.razao(Dinheiro.de('10'), Dinheiro.zero())).toBeNull());

  it('encargo 51% como fração', () => expect(Percentual.dePontos('51').comoFracao().toString()).toBe('0.51'));

  it('pontos com 4 casas Half-Even', () => {
    expect(Percentual.dePontos('4.83125').paraString()).toBe('4.8312');
    expect(Percentual.dePontos('4.83135').paraString()).toBe('4.8314');
  });

  it('formata em pt-BR', () => {
    expect(Percentual.razao(Dinheiro.de('569413.56'), Dinheiro.de('704831.00'))?.formatar()).toBe('80,79%');
    expect(Percentual.dePontos('51').formatar()).toBe('51,00%');
  });

  it('rejeita number', () => expect(() => Percentual.dePontos(51 as never)).toThrow(TypeError));
});

describe('Percentual: limites e propriedades (revisão 12.12)', () => {
  it('dePontos respeita NUMERIC(9,4)', () => {
    expect(Percentual.dePontos('99999.9999').paraString()).toBe('99999.9999');
    expect(() => Percentual.dePontos('100000')).toThrow(expect.objectContaining({ codigo: 'VALOR_FORA_DO_LIMITE' }));
    expect(() => Percentual.dePontos('-100000')).toThrow(ErroDominio);
  });

  it('rejeita Decimal NaN e Infinity', () => {
    expect(() => Percentual.dePontos(new Decimal(NaN))).toThrow(ErroDominio);
    expect(() => Percentual.dePontos(new Decimal(Infinity))).toThrow(ErroDominio);
  });

  it('razão com denominador diferente de zero nunca é null', () =>
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (n, d) => {
          const p = Percentual.razao(Dinheiro.de(`${n}`), Dinheiro.de(`${d}`));
          expect(p).not.toBeNull();
          expect(p!.paraString()).toMatch(/^-?\d+\.\d{2}$/);
        },
      ),
    ));
});

describe('Percentual: arredondamento e formato (revisão 12.12)', () => {
  it('razão em empate usa Half-Even', () => {
    expect(Percentual.razao(Dinheiro.de('1'), Dinheiro.de('800'))?.paraString()).toBe('0.12');
    expect(Percentual.razao(Dinheiro.de('-1'), Dinheiro.de('800'))?.paraString()).toBe('-0.12');
    expect(Percentual.razao(Dinheiro.de('3'), Dinheiro.de('800'))?.paraString()).toBe('0.38');
  });

  it('razão é indicador e não tem o limite de NUMERIC(9,4)', () => {
    expect(Percentual.razao(Dinheiro.de('1000000'), Dinheiro.de('0.01'))?.paraString()).toBe('10000000000.00');
  });

  it('formata 4 casas', () => expect(Percentual.dePontos('4.8312').formatar()).toBe('4,8312%'));
});
