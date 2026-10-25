import { describe, expect, it } from 'vitest';
import { Competencia } from './competencia';
import { ErroDominio } from './erros';

describe('Competencia (RN0302)', () => {
  it('RN0302', () => {
    expect(Competencia.parse('Jun/22').formatar()).toBe('Jun/22');
    expect(Competencia.de(2026, 12).proxima().formatar()).toBe('Jan/27');
    expect(() => Competencia.parse('Jun/2022')).toThrow(ErroDominio);
  });

  it('aceita minúsculas e devolve ano e mês', () => {
    const c = Competencia.parse('fev/27');
    expect([c.ano, c.mes]).toEqual([2027, 2]);
    expect(c.formatar()).toBe('Fev/27');
  });

  it.each(['Jun', 'Xyz/22', 'Jun/2', '13/22', ' Jun/22', 'Jun/22 '])('rejeita %j', (s) =>
    expect(() => Competencia.parse(s)).toThrow(ErroDominio));

  it.each([
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
    [1999, 1],
    [2100, 1],
  ])('rejeita de(%d, %d)', (ano, mes) => expect(() => Competencia.de(ano, mes)).toThrow(ErroDominio));

  it('compara por ano e mês', () => {
    expect(Competencia.de(2026, 12).comparar(Competencia.de(2027, 1))).toBe(-1);
    expect(Competencia.de(2027, 1).comparar(Competencia.parse('Jan/27'))).toBe(0);
    expect(Competencia.de(2027, 2).comparar(Competencia.de(2027, 1))).toBe(1);
  });

  it('formata todos os meses', () => {
    const meses = Array.from({ length: 12 }, (_, i) => Competencia.de(2027, i + 1).formatar().slice(0, 3));
    expect(meses).toEqual(['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']);
  });
});
