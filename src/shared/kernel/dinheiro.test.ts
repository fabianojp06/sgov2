import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from './dinheiro';
import { ErroDominio } from './erros';

describe('Dinheiro (spec §5, D5)', () => {
  it.each([
    ['0.125', '0.12'],
    ['0.135', '0.14'],
    ['2.675', '2.68'],
    ['-0.125', '-0.12'],
    ['1.005', '1.00'],
    ['7500', '7500.00'],
  ])('Half-Even %s → %s', (e, s) => expect(Dinheiro.de(e).paraString()).toBe(s));

  it('rejeita number', () => expect(() => Dinheiro.de(0.3 as never)).toThrow(TypeError));

  it('rejeita texto que não é número', () => expect(() => Dinheiro.de('abc')).toThrow(ErroDominio));

  it('limite NUMERIC(15,2)', () => {
    expect(() => Dinheiro.de('10000000000000.00')).toThrow(ErroDominio);
    expect(() => Dinheiro.de('-10000000000000.00')).toThrow(ErroDominio);
    expect(Dinheiro.de('9999999999999.99').paraString()).toBe('9999999999999.99');
  });

  it('aceita Decimal de outra configuração', () => {
    expect(Dinheiro.de(new Decimal('10.005')).paraString()).toBe('10.00');
  });

  it('formata', () => {
    expect(Dinheiro.de('1234.5').formatar()).toBe('R$ 1.234,50');
    expect(Dinheiro.de('-37109.7').formatar()).toBe('-R$ 37.109,70');
    expect(Dinheiro.zero().formatar()).toBe('R$ 0,00');
    expect(Dinheiro.de('9999999999999.99').formatar()).toBe('R$ 9.999.999.999.999,99');
  });

  it('soma exata do AC01 do OxR', () =>
    expect(
      Dinheiro.somarTodos(
        ['301922.05', '50148.86', '101916.93', '80813.67', '7083.48', '4310.03'].map((v) => Dinheiro.de(v)),
      ).paraString(),
    ).toBe('546195.02'));

  it('operações', () => {
    const a = Dinheiro.de('10.10');
    expect(a.somar(Dinheiro.de('0.20')).paraString()).toBe('10.30');
    expect(a.subtrair(Dinheiro.de('20')).paraString()).toBe('-9.90');
    expect(a.multiplicar('1.51').paraString()).toBe('15.25'); // 15.251 → 15.25
    expect(Dinheiro.de('100').dividir('3').paraString()).toBe('33.33');
    expect(Dinheiro.de('0.25').multiplicar('0.5').paraString()).toBe('0.12'); // 0.125 → 0.12
    expect(a.negar().paraString()).toBe('-10.10');
    expect(Dinheiro.zero().negar().paraString()).toBe('0.00');
  });

  it('comparações', () => {
    expect(Dinheiro.de('1').comparar(Dinheiro.de('2'))).toBe(-1);
    expect(Dinheiro.de('2').comparar(Dinheiro.de('2.00'))).toBe(0);
    expect(Dinheiro.de('3').comparar(Dinheiro.de('2'))).toBe(1);
    expect(Dinheiro.de('0.00').ehZero()).toBe(true);
    expect(Dinheiro.de('-0.01').ehNegativo()).toBe(true);
    expect(Dinheiro.de('-0.001').ehNegativo()).toBe(false); // arredonda para 0.00
  });

  it('dividir por zero é erro de domínio', () => {
    expect(() => Dinheiro.de('10').dividir('0')).toThrow(ErroDominio);
  });

  it('paraDecimal devolve o valor exato', () => {
    expect(Dinheiro.de('1234.5').paraDecimal().toFixed(2)).toBe('1234.50');
  });
});
