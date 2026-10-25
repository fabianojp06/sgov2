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
