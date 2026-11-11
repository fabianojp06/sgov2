import { describe, expect, it } from 'vitest';
import { inteiroEntre, lerDolar } from './valores';

describe('lerDolar', () => {
  it.each([
    ['150', '150.00'],
    ['150,5', '150.50'],
    ['1.234,56', '1234.56'],
    ['1234.56', '1234.56'],
    [' 0 ', '0.00'],
    ['007', '7.00'],
    ['9999999999,99', '9999999999.99'],
  ])('%s → %s', (texto, esperado) => expect(lerDolar(texto)).toBe(esperado));

  it.each(['', '-1', '1,234', '1.2.3', '12345678901', 'abc', '1e3', '1,2,3'])('recusa %j', (texto) => expect(lerDolar(texto)).toBeNull());
});

describe('inteiroEntre', () => {
  it('aceita a faixa e o ponto de milhar', () => {
    expect(inteiroEntre('10', 1, 1000)).toBe(10);
    expect(inteiroEntre('1.000', 1, 1000)).toBe(1000);
    expect(inteiroEntre('128.000', 1, 128_000)).toBe(128_000);
  });

  it('recusa fora da faixa, decimal e texto', () => {
    expect(inteiroEntre('0', 1, 1000)).toBeNull();
    expect(inteiroEntre('1001', 1, 1000)).toBeNull();
    expect(inteiroEntre('1,5', 1, 1000)).toBeNull();
    expect(inteiroEntre('dez', 1, 1000)).toBeNull();
  });
});
