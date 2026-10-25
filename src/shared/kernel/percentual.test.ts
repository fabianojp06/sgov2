import { describe, expect, it } from 'vitest';
import { Dinheiro } from './dinheiro';
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
