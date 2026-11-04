import { describe, expect, it } from 'vitest';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { mesmoConteudo, montarSnapshot } from './snapshot';

// Snapshot da oficialização (R10): JSON canônico e sha256.
describe('montarSnapshot', () => {
  it('chaves em ordens diferentes → mesmo conteúdo e mesmo sha256', () => {
    const a = montarSnapshot({ b: 1, a: { y: [1, 2], x: 'z' } });
    const b = montarSnapshot({ a: { x: 'z', y: [1, 2] }, b: 1 });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a.conteudo)).toBe('{"a":{"x":"z","y":[1,2]},"b":1}');
  });

  it('classe com toJSON (ex.: Decimal) vira o valor, não os campos internos', () => {
    class Decimal {
      constructor(private readonly v: string) {}
      toJSON() {
        return this.v;
      }
    }
    expect(montarSnapshot({ x: new Decimal('1.5') }).conteudo).toEqual({ x: '1.5' });
  });

  it('Dinheiro e Percentual como string decimal; Date em ISO; um centavo muda o sha256', () => {
    const s = montarSnapshot({ v: Dinheiro.de('1234.5'), p: Percentual.dePontos('51'), d: new Date('2026-11-30T12:00:00Z') });
    expect(s.conteudo).toEqual({ d: '2026-11-30T12:00:00.000Z', p: Percentual.dePontos('51').paraString(), v: '1234.50' });
    expect(montarSnapshot({ v: Dinheiro.de('1234.51') }).sha256).not.toBe(montarSnapshot({ v: Dinheiro.de('1234.50') }).sha256);
  });
});

describe('mesmoConteudo (R10)', () => {
  it('ignora a ordem das chaves e compara Dinheiro e Percentual pelo valor', () => {
    expect(mesmoConteudo({ b: Dinheiro.de('1.50'), a: [Percentual.dePontos('5')] }, { a: [Percentual.dePontos('5')], b: Dinheiro.de('1.50') })).toBe(true);
  });

  it('acusa conta zerada e aviso a mais', () => {
    const p = { contas: { ferias: '4.1.1.1.003' }, avisos: [] as string[] };
    expect(mesmoConteudo(p, { ...p, contas: { ferias: '' } })).toBe(false);
    expect(mesmoConteudo(p, { ...p, avisos: ['A conta não é mais analítica ativa.'] })).toBe(false);
  });
});
