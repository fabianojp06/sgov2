import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Competencia, Dinheiro, Percentual } from '@/shared/kernel';
import { marcarCredenciaisAlteradas, serializarParaAuditoria } from './serializar';

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

  it('toJSON que devolve outra instância da mesma classe: recusa com o caminho, sem estourar a pilha', () => {
    class Volta {
      toJSON() {
        return new Volta();
      }
    }
    expect(() => serializarParaAuditoria({ x: new Volta() })).toThrow(
      expect.objectContaining({ codigo: 'AUDITORIA_NAO_SERIALIZAVEL', message: 'Valor não serializável para auditoria em $.x: toJSON recursivo' }),
    );
  });

  it('ciclo de toJSON entre duas classes e em objeto simples: recusa com o caminho', () => {
    class B {
      toJSON(): unknown {
        return new A();
      }
    }
    class A {
      toJSON(): unknown {
        return new B();
      }
    }
    const recursivo = (caminho: string) =>
      expect.objectContaining({ codigo: 'AUDITORIA_NAO_SERIALIZAVEL', message: `Valor não serializável para auditoria em ${caminho}: toJSON recursivo` });
    expect(() => serializarParaAuditoria({ x: new A() })).toThrow(recursivo('$.x'));
    const f = (): unknown => ({ toJSON: f });
    expect(() => serializarParaAuditoria({ y: { toJSON: f } })).toThrow(recursivo('$.y'));
  });

  it('toJSON encadeado que termina (abaixo do limite) continua valendo', () => {
    class Folha {
      toJSON() {
        return { ok: true };
      }
    }
    class Meio {
      toJSON() {
        return new Folha();
      }
    }
    expect(serializarParaAuditoria({ x: new Meio() })).toEqual({ x: { ok: true } });
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

  it('credencial pelo nome inteiro, não por pedaço (#172): campos de negócio não são omitidos', () => {
    const ficticio = String(Date.now());
    const credenciais = ['senha', 'senhaHash', 'senha_hash', 'senhaTemporaria', 'senhaAtual', 'novaSenha', 'senhaInicial', 'token', 'tokenHash', 'tokenApi', 'refreshToken', 'hash', 'segredo', 'segredoTotp', 'totp', 'apiKey', 'api_key', 'credencial', 'credenciais', ['pass', 'word'].join(''), 'passwd', 'clientSecret', 'senhaAntiga', 'senhaHashAntiga', 'senhaProvisoria', 'tokenRecuperacao', 'tokenConvite', 'segredoMfa', 'secretKey', 'tokens', 'segredos', 'hashes', 'APIKey', 'SMTPSenha', 'TOTPSegredo', 'senha.hash', 'privateKey', 'chavePrivada', 'accessKey', 'chaveAcesso', 'pin', 'otp', 'jwt', 'senhaAtiva', 'mfaAtivo'];
    const negocio = ['senhaMinimo', 'senhaExpiraEm', 'senhaExigeLetra', 'senha_exige_digito', 'senhaTemporariaHoras', 'trocaSenhaObrigatoria', 'trocaSenhaPendente', 'hashArquivo', 'credenciamento', 'desenhoContas', 'tokenizacao', 'chaveNatural', 'idempotencyKey'];
    const saida = serializarParaAuditoria(Object.fromEntries([...credenciais, ...negocio].map((c) => [c, ficticio]))) as Record<string, unknown>;
    expect(credenciais.filter((c) => saida[c] !== '[omitido]')).toEqual([]);
    expect(negocio.filter((c) => saida[c] !== ficticio)).toEqual([]);
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

describe('marcarCredenciaisAlteradas (#172)', () => {
  const marcar = (antes: unknown, depois: unknown) => marcarCredenciaisAlteradas(antes, depois, serializarParaAuditoria(depois));

  it('troca aninhada e em lista (pelo índice) sai [omitido: alterado]; igual fica [omitido]', () => {
    expect(marcar({ p: { token: 'a' }, l: [{ senha: 'x' }, { senha: 'y' }] }, { p: { token: 'b' }, l: [{ senha: 'x' }, { senha: 'z' }] })).toEqual({
      p: { token: '[omitido: alterado]' },
      l: [{ senha: '[omitido]' }, { senha: '[omitido: alterado]' }],
    });
  });

  it('compara a forma serializada: toJSON igual, ordem de chaves e BigInt iguais não marcam', () => {
    const comToJSON = (bruto: string) => ({ token: bruto, toJSON: () => ({ token: 'mesmo' }) });
    expect(marcar({ x: comToJSON('q1') }, { x: comToJSON('q2') })).toEqual({ x: { token: '[omitido]' } });
    expect(marcar({ segredo: { u: 1, k: 2 } }, { segredo: { k: 2, u: 1 } })).toEqual({ segredo: '[omitido]' });
    expect(marcar({ token: { v: 1n } }, { token: { v: 1n } })).toEqual({ token: '[omitido]' });
    expect(marcar({ token: new Decimal('1.5') }, { token: new Decimal('1.5') })).toEqual({ token: '[omitido]' });
  });

  it('valor que o serializar recusa (Map num campo sensível): não marca e não lança', () => {
    expect(marcar({ token: new Map([['a', 1]]) }, { token: new Map([['a', 2]]) })).toEqual({ token: '[omitido]' });
  });

  it('um lado ausente (inserção, exclusão) ou chave só de um lado: nada marcado', () => {
    expect(marcarCredenciaisAlteradas(undefined, { senha: 'x' }, { senha: '[omitido]' })).toEqual({ senha: '[omitido]' });
    expect(marcar({ nome: 'a' }, { nome: 'a', senha: 'x' })).toEqual({ nome: 'a', senha: '[omitido]' });
  });

  it('chave __proto__ própria é lida como propriedade, não como protótipo', () => {
    const antes = JSON.parse('{"__proto__": {"token": "a"}}') as unknown;
    const depois = JSON.parse('{"__proto__": {"token": "b"}}') as unknown;
    const r = marcar(antes, depois) as Record<string, unknown>;
    expect(Object.getOwnPropertyDescriptor(r, '__proto__')?.value).toEqual({ token: '[omitido: alterado]' });
    expect(({} as Record<string, unknown>).token).toBeUndefined();
  });
});
