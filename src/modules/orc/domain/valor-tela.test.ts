import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { valorDaTela, valorParaTela } from './valor-tela';

// Valor digitado na tela no formato brasileiro (Task 5): vira o texto que lerValor entende.
describe('valorDaTela', () => {
  it.each([
    ['1000', '1000'],
    ['1.000', '1000'],
    ['1.000,5', '1000.5'],
    ['1.234.567,89', '1234567.89'],
    ['0,01', '0.01'],
    [' 350,00 ', '350.00'],
    ['-1', '-1'],
    ['', ''],
  ])('%j → %j', (entrada, saida) => expect(valorDaTela(entrada)).toBe(saida));

  it.each(['1,000.50', '1.00', '1,234', '12.34,5', 'R$ 10', '1e3', 'abc'])('%j fica como veio (lerValor recusa)', (v) =>
    expect(valorDaTela(v)).toBe(v.trim()),
  );
});

describe('valorParaTela', () => {
  it.each([
    ['1234567.89', '1.234.567,89'],
    ['0.5', '0,50'],
    ['100', '100,00'],
    ['-1000', '-1.000,00'],
  ])('%s → %s', (v, t) => expect(valorParaTela(Dinheiro.de(v))).toBe(t));

  it('ida e volta', () => expect(valorDaTela(valorParaTela(Dinheiro.de('98765.43')))).toBe('98765.43'));
});
