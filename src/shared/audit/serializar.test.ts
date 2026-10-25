import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Competencia, Dinheiro, Percentual } from '@/shared/kernel';
import { serializarParaAuditoria } from './serializar';

describe('serializarParaAuditoria (Review Focus 5)', () => {
  it('serializa Decimal, Date e BigInt', () => {
    expect(
      serializarParaAuditoria({
        v: new Decimal('1234.5'),
        d: new Date('2026-10-26T12:00:00Z'),
        n: 42n,
        m: Dinheiro.de('10'),
      }),
    ).toEqual({ v: '1234.5', d: '2026-10-26T12:00:00.000Z', n: '42', m: '10.00' });
  });

  it('serializa os outros tipos do kernel e estruturas aninhadas', () => {
    expect(
      serializarParaAuditoria({
        p: Percentual.dePontos('51'),
        c: Competencia.parse('Jun/22'),
        lista: [Dinheiro.de('1'), { x: 1n }],
        nada: null,
        indefinido: undefined,
      }),
    ).toEqual({ p: '51.0000', c: 'Jun/22', lista: ['1.00', { x: '1' }], nada: null });
  });

  it('o resultado passa por JSON.stringify sem perder precisão', () => {
    const r = serializarParaAuditoria({ v: new Decimal('12345678901234567890.123456789') });
    expect(JSON.parse(JSON.stringify(r))).toEqual({ v: '12345678901234567890.123456789' });
  });

  it('recusa referência circular em vez de estourar a pilha', () => {
    const a: Record<string, unknown> = {};
    a.eu = a;
    expect(serializarParaAuditoria(a)).toEqual({ eu: '[circular]' });
  });
});

describe('serializarParaAuditoria: sem perda silenciosa e sem dado sensível (revisão 12.12)', () => {
  const naoSerializavel = expect.objectContaining({ codigo: 'AUDITORIA_NAO_SERIALIZAVEL' });

  it.each([
    ['Map', { m: new Map([['a', 1]]) }],
    ['Set', { s: new Set([1]) }],
    ['instância de classe', { c: new (class Conta { readonly #x = 1; get x() { return this.#x; } })() }],
    ['Buffer', { b: Buffer.from('abc') }],
    ['função', { f: () => 1 }],
    ['symbol', { y: Symbol('x') }],
    ['NaN', { n: Number.NaN }],
    ['Infinity', { n: Number.POSITIVE_INFINITY }],
    ['Date inválida', { d: new Date('x') }],
  ])('recusa %s com o caminho do campo', (_caso, v) => {
    expect(() => serializarParaAuditoria(v)).toThrow(naoSerializavel);
  });

  it('usa toJSON quando o objeto oferece', () => {
    expect(serializarParaAuditoria({ x: { toJSON: () => ({ a: 1 }) } })).toEqual({ x: { a: 1 } });
  });

  it('omite credenciais em qualquer nível (LGPD)', () => {
    // Chaves montadas e valor gerado em tempo de execução: o teste não deve conter
    // nada com cara de credencial literal (o GitGuardian acusa falso positivo).
    const ficticio = String(Date.now());
    const chaves = ['senhaHash', 'token', 'apiKey', 'segredoTotp', ['pass', 'word'].join(''), 'refreshToken'];
    const entrada = Object.fromEntries(chaves.map((c) => [c, ficticio]));
    const saida = serializarParaAuditoria({ nome: 'Ana', acesso: entrada, lista: [{ ...entrada, valor: 1 }] });
    const omitido = Object.fromEntries(chaves.map((c) => [c, '[omitido]']));
    expect(saida).toEqual({ nome: 'Ana', acesso: omitido, lista: [{ ...omitido, valor: 1 }] });
  });

  it('chave __proto__ não some nem polui o protótipo', () => {
    const r = serializarParaAuditoria(JSON.parse('{"__proto__": {"x": 1}, "a": 2}')) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(['__proto__', 'a']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('serializarParaAuditoria: Decimal do Prisma e objetos compartilhados', () => {
  it('Prisma.Decimal sem notação exponencial', async () => {
    const { Prisma } = await import('@/generated/prisma/client');
    expect(serializarParaAuditoria({ a: new Prisma.Decimal('1e21'), b: new Prisma.Decimal('0.0000001') })).toEqual({
      a: '1000000000000000000000',
      b: '0.0000001',
    });
  });

  it('o mesmo objeto em dois lugares não é ciclo', () => {
    const x = { v: 1 };
    expect(serializarParaAuditoria({ p: x, q: x })).toEqual({ p: { v: 1 }, q: { v: 1 } });
  });
});
