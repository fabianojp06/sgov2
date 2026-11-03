import { describe, expect, it } from 'vitest';
import { calcularDelta } from './delta';

describe('calcularDelta', () => {
  it('só os campos que mudaram', () => {
    expect(calcularDelta({ a: 1, b: 'x' }, { a: 2, b: 'x', c: true })).toEqual({
      a: { de: 1, para: 2 },
      c: { de: undefined, para: true },
    });
  });

  it('inserção: antes nulo', () => expect(calcularDelta(null, { a: 1 })).toEqual({ a: { de: undefined, para: 1 } }));

  it('exclusão: depois nulo', () => expect(calcularDelta({ a: 1 }, undefined)).toEqual({ a: { de: 1, para: undefined } }));

  it('chave __proto__ vira campo do delta e não polui o protótipo', () => {
    const r = calcularDelta(JSON.parse('{"__proto__": 1, "a": 1}'), JSON.parse('{"__proto__": 2, "a": 1}'));
    expect(Object.keys(r)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(r, '__proto__')?.value).toEqual({ de: 1, para: 2 });
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(JSON.stringify(r)).toBe('{"__proto__":{"de":1,"para":2}}');
  });

  it('compara objetos e listas por valor', () => {
    expect(calcularDelta({ o: { x: 1 }, l: [1, 2] }, { o: { x: 1 }, l: [1, 2] })).toEqual({});
    expect(calcularDelta({ l: [1, 2] }, { l: [1, 3] })).toEqual({ l: { de: [1, 2], para: [1, 3] } });
  });

  it('valor que não é objeto vira campo "valor"', () =>
    expect(calcularDelta('a', 'b')).toEqual({ valor: { de: 'a', para: 'b' } }));
});
