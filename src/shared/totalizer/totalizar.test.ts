import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Dinheiro, Percentual } from '@/shared/kernel';
import type { NoArvore } from './arvore';
import { totalizar, totalizarSerie } from './totalizar';

const sintetica = (id: string, paiId: string | null): NoArvore => ({ id, paiId, tipo: 'SINTETICA' });
const analitica = (id: string, paiId: string): NoArvore => ({ id, paiId, tipo: 'ANALITICA' });
const d = (v: string) => Dinheiro.de(v);

// Árvore de pessoal do AC01 do OxR V2: 4 → 4.1 → 4.1.1 → 4.1.1.1 com 24 analíticas.
const ramo = [sintetica('4', null), sintetica('4.1', '4'), sintetica('4.1.1', '4.1'), sintetica('4.1.1.1', '4.1.1')];
const pessoal = Array.from({ length: 24 }, (_, i) => analitica(`4.1.1.1.${String(i + 1).padStart(2, '0')}`, '4.1.1.1'));
const VALORES_AC01 = ['301922.05', '50148.86', '101916.93', '80813.67', '7083.48', '4310.03'];

describe('totalizar (US-009)', () => {
  it('AC01: sintéticas somam as analíticas; ausentes contam zero', () => {
    const valores = new Map(VALORES_AC01.map((v, i) => [pessoal[i]!.id, d(v)]));
    const r = totalizar([...ramo, ...pessoal], valores);
    for (const id of ['4.1.1.1', '4.1.1', '4.1', '4']) expect(r.valor(id).paraString()).toBe('546195.02');
    expect(r.total.paraString()).toBe('546195.02');
    expect(r.valor(pessoal[23]!.id).paraString()).toBe('0.00');
  });

  it('o total é a soma das raízes (RN_OXR_009)', () => {
    const nos = [sintetica('3', null), analitica('3.1', '3'), sintetica('4', null), analitica('4.1', '4')];
    const r = totalizar(nos, new Map([['3.1', d('100')], ['4.1', d('-30.5')]]));
    expect(r.total.paraString()).toBe('69.50');
  });

  it('percentuais do pai e do total', () => {
    const nos = [sintetica('4', null), analitica('4.1', '4'), analitica('4.2', '4')];
    const r = totalizar(nos, new Map([['4.1', d('300')], ['4.2', d('100')]]));
    expect(r.percentualDoPai('4.1')?.paraString()).toBe('75.00');
    expect(r.percentualDoTotal('4.2')?.paraString()).toBe('25.00');
    expect(r.percentualDoPai('4')).toBeNull();
    expect(r.percentualDoTotal('4')?.paraString()).toBe('100.00');
  });

  it('percentualDoPai com pai zerado → null (RN_OXR_012)', () => {
    const nos = [sintetica('4', null), analitica('4.1', '4')];
    const r = totalizar(nos, new Map());
    expect(r.percentualDoPai('4.1')).toBeNull();
    expect(r.percentualDoTotal('4.1')).toBeNull();
  });

  it.each([
    ['valor numa sintética', [sintetica('4', null), analitica('4.1', '4')], [['4', '1']], 'VALOR_EM_SINTETICA'],
    ['pai inexistente', [sintetica('4', null), analitica('4.1', '9')], [], 'PAI_INEXISTENTE'],
    ['ciclo', [sintetica('a', 'b'), sintetica('b', 'a'), sintetica('r', null)], [], 'CICLO'],
    ['nó que é pai de si mesmo', [sintetica('a', 'a')], [], 'CICLO'],
    ['id repetido', [sintetica('4', null), sintetica('4', null)], [], 'ID_DUPLICADO'],
    ['valor para nó inexistente', [sintetica('4', null), analitica('4.1', '4')], [['9', '1']], 'NO_INEXISTENTE'],
    ['analítica com filhos', [sintetica('4', null), analitica('4.1', '4'), analitica('4.1.1', '4.1')], [], 'ANALITICA_COM_FILHOS'],
  ] as const)('%s → %s', (_caso, nos, valores, codigo) => {
    const mapa = new Map(valores.map(([id, v]) => [id, d(v)]));
    expect(() => totalizar(nos, mapa)).toThrow(expect.objectContaining({ codigo }));
  });

  it('consultar nó inexistente é erro de domínio', () => {
    const r = totalizar([sintetica('4', null)], new Map());
    expect(() => r.valor('9')).toThrow(expect.objectContaining({ codigo: 'NO_INEXISTENTE' }));
  });

  it('desempenho (spec §10.3): 1.000 analíticas sob 50 sintéticas em menos de 2 s', () => {
    const nos: NoArvore[] = [sintetica('raiz', null)];
    const valores = new Map<string, Dinheiro>();
    for (let s = 0; s < 50; s++) {
      nos.push(sintetica(`s${s}`, 'raiz'));
      for (let a = 0; a < 20; a++) {
        const id = `s${s}.a${a}`;
        nos.push(analitica(id, `s${s}`));
        valores.set(id, d(`${s}.${String(a).padStart(2, '0')}`));
      }
    }
    const inicio = performance.now();
    const r = totalizar(nos, valores);
    expect(performance.now() - inicio).toBeLessThan(2000);
    expect(r.total.paraString()).toBe(Dinheiro.somarTodos([...valores.values()]).paraString());
  });
});

describe('totalizarSerie', () => {
  it('AC02 a AC04: somas do período, saldo e percentual', () => {
    const nos = [...ramo, analitica('4.1.1.1.01', '4.1.1.1')];
    const orcado = totalizarSerie(nos, new Map([['4.1.1.1.01', [d('704831.00'), d('540656.00')]]]), 2);
    const realizado = totalizarSerie(nos, new Map([['4.1.1.1.01', [d('569413.56'), d('713183.14')]]]), 2);
    const somaOrcado = Dinheiro.somarTodos(orcado.valor('4.1.1.1'));
    const somaRealizado = Dinheiro.somarTodos(realizado.valor('4.1.1.1'));
    expect(somaOrcado.paraString()).toBe('1245487.00');
    expect(somaRealizado.paraString()).toBe('1282596.70');
    expect(somaOrcado.subtrair(somaRealizado).paraString()).toBe('-37109.70');
    expect(Percentual.razao(somaRealizado, somaOrcado)?.paraString()).toBe('102.98');
    expect(orcado.total.map((v) => v.paraString())).toEqual(['704831.00', '540656.00']);
    expect(orcado.valor('4.1.1.1').map((v) => v.paraString())).toEqual(['704831.00', '540656.00']);
    // RN_OXR_010, % de uso do mês: AC02 (Set/18) e AC03 (Out/18).
    const uso = [0, 1].map((m) =>
      Percentual.razao(realizado.valor('4.1.1.1')[m]!, orcado.valor('4.1.1.1')[m]!)?.paraString(),
    );
    expect(uso).toEqual(['80.79', '131.91']);
  });

  it('12 meses por padrão; analítica ausente vale zero em todos os meses', () => {
    const nos = [sintetica('4', null), analitica('4.1', '4'), analitica('4.2', '4')];
    const s = totalizarSerie(nos, new Map([['4.1', Array.from({ length: 12 }, () => d('1'))]]));
    expect(s.valor('4').map((v) => v.paraString())).toEqual(Array(12).fill('1.00'));
    expect(s.valor('4.2').map((v) => v.paraString())).toEqual(Array(12).fill('0.00'));
  });

  it('série com tamanho diferente de meses → erro de domínio', () => {
    const nos = [sintetica('4', null), analitica('4.1', '4')];
    expect(() => totalizarSerie(nos, new Map([['4.1', [d('1')]]]), 2)).toThrow(
      expect.objectContaining({ codigo: 'SERIE_TAMANHO' }),
    );
  });
});

describe('revisão 12.12', () => {
  it('percentual do pai é diferente do percentual do total em árvore com 2 raízes e 3 níveis', () => {
    const nos = [
      sintetica('3', null),
      analitica('3.1', '3'),
      sintetica('4', null),
      sintetica('4.1', '4'),
      analitica('4.1.1', '4.1'),
      analitica('4.1.2', '4.1'),
    ];
    const r = totalizar(nos, new Map([['3.1', d('200')], ['4.1.1', d('150')], ['4.1.2', d('50')]]));
    expect(r.percentualDoPai('4.1.1')?.paraString()).toBe('75.00');
    expect(r.percentualDoTotal('4.1.1')?.paraString()).toBe('37.50');
  });

  it('estouro intermediário não depende da ordem dos nós; o limite vale no resultado de cada nó', () => {
    const base = [sintetica('s', null)];
    const filhos = [analitica('x', 's'), analitica('y', 's'), analitica('z', 's')];
    const valores = new Map([['x', d('9000000000000')], ['y', d('9000000000000')], ['z', d('-9000000000000')]]);
    for (const ordem of [filhos, [filhos[2]!, filhos[0]!, filhos[1]!]]) {
      expect(totalizar([...base, ...ordem], valores).total.paraString()).toBe('9000000000000.00');
    }
  });

  it('estouro no resultado de um nó diz qual conta estourou', () => {
    const nos = [sintetica('4.1', null), analitica('a', '4.1'), analitica('b', '4.1')];
    const valores = new Map([['a', d('9000000000000')], ['b', d('9000000000000')]]);
    expect(() => totalizar(nos, valores)).toThrow(
      expect.objectContaining({ codigo: 'VALOR_FORA_DO_LIMITE', message: expect.stringContaining('4.1') }),
    );
  });

  it.each([0, -1, 1.5])('meses inválido (%s) → erro de domínio', (meses) => {
    expect(() => totalizarSerie([sintetica('4', null)], new Map(), meses)).toThrow(
      expect.objectContaining({ codigo: 'MESES_INVALIDO' }),
    );
  });

  it('série com buraco (array esparso) → erro de domínio', () => {
    const nos = [sintetica('4', null), analitica('4.1', '4')];
    // eslint-disable-next-line no-sparse-arrays
    expect(() => totalizarSerie(nos, new Map([['4.1', [, d('1')] as Dinheiro[]]]), 2)).toThrow(
      expect.objectContaining({ codigo: 'SERIE_INVALIDA' }),
    );
  });

  it('id enorme é truncado na mensagem', () => {
    const id = 'x'.repeat(10_000);
    try {
      totalizar([sintetica(id, null), sintetica(id, null)], new Map());
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(200);
    }
  });

  it('ciclo pendurado (nó válido cujo pai está num ciclo) → CICLO, com detalhes limitados', () => {
    const nos = [sintetica('r', null), sintetica('a', 'b'), sintetica('b', 'a'), sintetica('c', 'a')];
    expect(() => totalizar(nos, new Map())).toThrow(expect.objectContaining({ codigo: 'CICLO' }));
  });

  it('cadeia de 5.000 níveis não estoura a pilha', () => {
    const nos: NoArvore[] = [sintetica('n0', null)];
    for (let i = 1; i < 5000; i++) nos.push(sintetica(`n${i}`, `n${i - 1}`));
    nos.push(analitica('folha', 'n4999'));
    expect(totalizar(nos, new Map([['folha', d('1')]])).valor('n0').paraString()).toBe('1.00');
  });
});

describe('propriedades', () => {
  // Floresta aleatória sem ciclo: o pai de cada sintética é uma sintética anterior (ou nenhum).
  const floresta = fc
    .array(fc.tuple(fc.nat(), fc.boolean(), fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n })), {
      minLength: 1,
      maxLength: 60,
    })
    .map((itens) => {
      const nos: NoArvore[] = [];
      const valores = new Map<string, Dinheiro>();
      const sinteticas: string[] = [];
      itens.forEach(([pai, ehSintetica, centavos], i) => {
        const paiId = sinteticas.length === 0 || pai % 4 === 0 ? null : sinteticas[pai % sinteticas.length]!;
        if (ehSintetica || paiId === null) {
          nos.push({ id: `n${i}`, paiId, tipo: 'SINTETICA' });
          sinteticas.push(`n${i}`);
        } else {
          nos.push({ id: `n${i}`, paiId, tipo: 'ANALITICA' });
          valores.set(`n${i}`, Dinheiro.de(`${centavos}`).dividir('100'));
        }
      });
      return { nos, valores };
    });

  it('total = soma das analíticas; sintética = soma dos filhos diretos; ordem dos nós não importa', () =>
    fc.assert(
      fc.property(floresta, fc.integer(), ({ nos, valores }, semente) => {
        const r = totalizar(nos, valores);
        expect(r.total.paraString()).toBe(Dinheiro.somarTodos([...valores.values()]).paraString());
        for (const no of nos.filter((n) => n.tipo === 'SINTETICA')) {
          const filhos = nos.filter((n) => n.paiId === no.id).map((n) => r.valor(n.id));
          expect(r.valor(no.id).paraString()).toBe(Dinheiro.somarTodos(filhos).paraString());
        }
        const embaralhados = [...nos].sort((a, b) => ((a.id.length * 31 + semente) % 7) - ((b.id.length * 17) % 7));
        expect(totalizar(embaralhados, valores).total.paraString()).toBe(r.total.paraString());
      }),
    ));
});
