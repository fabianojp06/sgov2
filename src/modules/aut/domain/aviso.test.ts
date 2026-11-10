import { describe, expect, it } from 'vitest';
import { avisoDesativacao } from './aviso';

describe('avisoDesativacao (UC02.01 2.7)', () => {
  it.each([
    [300, 5],
    [299, 5],
    [61, 2],
    [60, 1],
    [1, 1],
    [0, 0],
    [-5, 0],
  ])('%i s → %i minutos', (segundos, minutos) =>
    expect(avisoDesativacao(segundos)).toBe(`O sistema será desativado em ${minutos} minutos. Por favor, salve seus trabalhos correntes.`));
});
