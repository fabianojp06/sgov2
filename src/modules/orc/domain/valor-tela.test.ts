import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { lerValor } from './planilha';
import { VALOR_INVALIDO, valorDaTela, valorParaTela } from './valor-tela';

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

  it.each(['1,000.50', '1.00', '1.5', '1,234', '12.34,5', 'R$ 1.000'])('%j com ponto ou vírgula fora do formato: marcado inválido, e lerValor recusa', (v) => {
    expect(valorDaTela(v)).toBe(VALOR_INVALIDO);
    expect(lerValor(valorDaTela(v))).toBe('INVALIDO');
  });

  it.each(['1e3', 'abc', 'R$ 10'])('%j sem ponto nem vírgula fica como veio, e lerValor recusa', (v) => {
    expect(valorDaTela(v)).toBe(v);
    expect(lerValor(valorDaTela(v))).toBe('INVALIDO');
  });
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
