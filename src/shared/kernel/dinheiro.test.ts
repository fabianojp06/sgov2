import Decimal from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Dinheiro } from './dinheiro';
import { ErroDominio } from './erros';

describe('Dinheiro (spec §5, D5)', () => {
  it.each([
    ['0.125', '0.12'],
    ['0.135', '0.14'],
    ['2.675', '2.68'],
    ['-0.125', '-0.12'],
    ['1.005', '1.00'],
    ['7500', '7500.00'],
  ])('Half-Even %s → %s', (e, s) => expect(Dinheiro.de(e).paraString()).toBe(s));

  it('rejeita number', () => expect(() => Dinheiro.de(0.3 as never)).toThrow(TypeError));

  it('rejeita texto que não é número', () => expect(() => Dinheiro.de('abc')).toThrow(ErroDominio));

  it('limite NUMERIC(15,2)', () => {
    expect(() => Dinheiro.de('10000000000000.00')).toThrow(ErroDominio);
    expect(() => Dinheiro.de('-10000000000000.00')).toThrow(ErroDominio);
    expect(Dinheiro.de('9999999999999.99').paraString()).toBe('9999999999999.99');
  });

  it('aceita Decimal de outra configuração', () => {
    expect(Dinheiro.de(new Decimal('10.005')).paraString()).toBe('10.00');
  });

  it('formata', () => {
    expect(Dinheiro.de('1234.5').formatar()).toBe('R$ 1.234,50');
    expect(Dinheiro.de('-37109.7').formatar()).toBe('-R$ 37.109,70');
    expect(Dinheiro.zero().formatar()).toBe('R$ 0,00');
    expect(Dinheiro.de('9999999999999.99').formatar()).toBe('R$ 9.999.999.999.999,99');
  });

  it('soma exata do AC01 do OxR', () =>
    expect(
      Dinheiro.somarTodos(
        ['301922.05', '50148.86', '101916.93', '80813.67', '7083.48', '4310.03'].map((v) => Dinheiro.de(v)),
      ).paraString(),
    ).toBe('546195.02'));

  it('operações', () => {
    const a = Dinheiro.de('10.10');
    expect(a.somar(Dinheiro.de('0.20')).paraString()).toBe('10.30');
    expect(a.subtrair(Dinheiro.de('20')).paraString()).toBe('-9.90');
    expect(a.multiplicar('1.51').paraString()).toBe('15.25'); // 15.251 → 15.25
    expect(Dinheiro.de('100').dividir('3').paraString()).toBe('33.33');
    expect(Dinheiro.de('0.25').multiplicar('0.5').paraString()).toBe('0.12'); // 0.125 → 0.12
    expect(a.negar().paraString()).toBe('-10.10');
    expect(Dinheiro.zero().negar().paraString()).toBe('0.00');
  });

  it('comparações', () => {
    expect(Dinheiro.de('1').comparar(Dinheiro.de('2'))).toBe(-1);
    expect(Dinheiro.de('2').comparar(Dinheiro.de('2.00'))).toBe(0);
    expect(Dinheiro.de('3').comparar(Dinheiro.de('2'))).toBe(1);
    expect(Dinheiro.de('0.00').ehZero()).toBe(true);
    expect(Dinheiro.de('-0.01').ehNegativo()).toBe(true);
    expect(Dinheiro.de('-0.001').ehNegativo()).toBe(false); // arredonda para 0.00
  });

  it('dividir por zero é erro de domínio', () => {
    expect(() => Dinheiro.de('10').dividir('0')).toThrow(ErroDominio);
  });

  it('paraDecimal devolve o valor exato', () => {
    expect(Dinheiro.de('1234.5').paraDecimal().toFixed(2)).toBe('1234.50');
  });
});

describe('Dinheiro: entradas inválidas e invariantes (revisão 12.12)', () => {
  it('igual() compara o valor, não a referência', () => {
    expect(Dinheiro.de('10').igual(Dinheiro.de('10.00'))).toBe(true);
    expect(Dinheiro.de('10').igual(Dinheiro.de('10.01'))).toBe(false);
  });

  it('Decimal com expoente ou dígitos demais é recusado sem montar o texto; resíduo minúsculo vale zero (#168)', () => {
    const invalido = expect.objectContaining({ codigo: 'VALOR_INVALIDO' });
    expect(() => Dinheiro.de(new Decimal('1e5000000'))).toThrow(invalido);
    expect(() => Dinheiro.de(new Decimal('1e41'))).toThrow(invalido);
    expect(() => Dinheiro.de(new Decimal('1e40'))).toThrow(expect.objectContaining({ codigo: 'VALOR_FORA_DO_LIMITE' }));
    expect(() => Dinheiro.de(new Decimal(`0.${'1'.repeat(100_000)}`))).toThrow(invalido);
    expect(Dinheiro.de(new Decimal('1e-5000000')).paraString()).toBe('0.00');
    expect(Dinheiro.de(new Decimal('-1e-44')).paraString()).toBe('0.00');
    expect(Dinheiro.de('10').multiplicar(new Decimal('1e-44')).paraString()).toBe('0.00');
    expect(Dinheiro.de(new Decimal('1234.5')).paraString()).toBe('1234.50');
  });

  it('a mensagem do texto inválido escapa caracteres de controle (#168)', () => {
    expect(() => Dinheiro.de('1\n2\u001b')).toThrow('Valor inválido para Dinheiro: "1\\n2\\u001b"');
  });

  it.each([
    ['NaN', new Decimal(NaN)],
    ['Infinity', new Decimal(Infinity)],
    ['-Infinity', new Decimal(-Infinity)],
  ])('rejeita Decimal %s como VALOR_INVALIDO', (_nome, v) => {
    expect(() => Dinheiro.de(v)).toThrow(expect.objectContaining({ codigo: 'VALOR_INVALIDO' }));
    expect(() => Dinheiro.de('1').multiplicar(v)).toThrow(ErroDominio);
    expect(() => Dinheiro.de('1').dividir(v)).toThrow(ErroDominio);
  });

  it('rejeita objeto que só finge ser Decimal', () => {
    // decimal.js reconhece Decimal pela propriedade toStringTag.
    const falso = { toStringTag: '[object Decimal]', toString: () => '0x1F', toFixed: () => '0x1F' };
    expect(() => Dinheiro.de(falso as never)).toThrow(ErroDominio);
    expect(() => Dinheiro.de({ toStringTag: '[object Decimal]' } as never)).toThrow(ErroDominio);
  });

  it('aceita Decimal em notação exponencial', () => {
    expect(Dinheiro.de(new Decimal('1e-7')).paraString()).toBe('0.00');
    expect(Dinheiro.de(new Decimal('1.5e3')).paraString()).toBe('1500.00');
  });

  it('rejeita texto longo demais antes de calcular (DoS)', () => {
    const enorme = '9'.repeat(1_000_000);
    expect(() => Dinheiro.de(enorme)).toThrow(expect.objectContaining({ codigo: 'VALOR_INVALIDO' }));
    expect(() => Dinheiro.de('1').dividir(enorme)).toThrow(ErroDominio);
    try {
      Dinheiro.de(enorme);
    } catch (e) {
      expect(JSON.stringify(e).length + (e as Error).message.length).toBeLessThan(200);
    }
  });

  it('paraDecimal não expõe o estado interno', () => {
    const x = Dinheiro.de('10');
    (x.paraDecimal() as unknown as { d: number[] }).d[0] = 99;
    expect(x.paraString()).toBe('10.00');
  });
});

describe('Dinheiro: propriedades', () => {
  const centavos = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
  const dinheiro = centavos.map((c) => Dinheiro.de(new Decimal(c.toString()).div(100)));

  it('soma é comutativa e associativa, sem deriva', () =>
    fc.assert(
      fc.property(dinheiro, dinheiro, dinheiro, (a, b, c) => {
        expect(a.somar(b).paraString()).toBe(b.somar(a).paraString());
        expect(a.somar(b).somar(c).paraString()).toBe(a.somar(b.somar(c)).paraString());
      }),
    ));

  it('negar é involução e a - a = 0', () =>
    fc.assert(
      fc.property(dinheiro, (a) => {
        expect(a.negar().negar().paraString()).toBe(a.paraString());
        expect(a.subtrair(a).paraString()).toBe('0.00');
      }),
    ));

  it('paraString ida e volta', () =>
    fc.assert(
      fc.property(dinheiro, (a) => {
        expect(Dinheiro.de(a.paraString()).comparar(a)).toBe(0);
      }),
    ));
});

describe('Dinheiro: casos de borda (revisão 12.12)', () => {
  it('divisão por zero tem código próprio', () =>
    expect(() => Dinheiro.de('10').dividir('0')).toThrow(expect.objectContaining({ codigo: 'DIVISAO_POR_ZERO' })));

  it('o limite vale depois do arredondamento', () => {
    expect(Dinheiro.de('9999999999999.991').paraString()).toBe('9999999999999.99');
    expect(() => Dinheiro.de('9999999999999.995')).toThrow(expect.objectContaining({ codigo: 'VALOR_FORA_DO_LIMITE' }));
  });

  it('somarTodos só confere o limite no total', () => {
    const xs = ['9999999999999.99', '1', '-1'].map((v) => Dinheiro.de(v));
    expect(Dinheiro.somarTodos(xs).paraString()).toBe('9999999999999.99');
    expect(() => Dinheiro.somarTodos(['9999999999999.99', '0.01'].map((v) => Dinheiro.de(v)))).toThrow(ErroDominio);
  });
});
