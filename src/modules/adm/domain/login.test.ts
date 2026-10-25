import { describe, expect, it } from 'vitest';
import { normalizarLogin } from './login';

describe('normalizarLogin (RN0518, D-P5-3)', () => {
  it.each([
    [' Admin ', 'admin'],
    ['joao.silva-2', 'joao.silva-2'],
    ['ANA_MARIA', 'ana_maria'],
    ['abc', 'abc'],
  ])('%j → %j', (bruto, esperado) => expect(normalizarLogin(bruto)).toBe(esperado));

  it.each([['ADMİN'], ['ab'], ['a b'], ['joão'], [''], ['   '], ['x'.repeat(61)], ['a@b'], ['...'], ['-abc'], ['.abc'], ['_ab']])('%j → null', (bruto) =>
    expect(normalizarLogin(bruto)).toBeNull(),
  );

  it('aceita 60 caracteres', () => expect(normalizarLogin('a'.repeat(60))).toBe('a'.repeat(60)));
});
