import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { comSinal, compararVersoes, type LadoComparacao } from './comparacao';

const R = (v: string) => Dinheiro.de(v);
const lado = (contas: Record<string, string>, extra: Partial<Omit<LadoComparacao, 'porConta'>> = {}): LadoComparacao => {
  const porConta = new Map(Object.entries(contas).map(([c, v]) => [c, R(v)]));
  return { porConta, total: Dinheiro.somarTodos([...porConta.values()]), rateio: Dinheiro.zero(), tetos: Dinheiro.zero(), ...extra };
};

describe('compararVersoes (US-084, IA-13)', () => {
  it('conta nova, retirada e alterada, cada uma no seu grupo, em ordem de conta (Review Focus 3)', () => {
    const c = compararVersoes(lado({ '4.1.1.10.001': '100.00', '4.1.1.2.001': '1100.00', '4.1.1.5.005': '50.00' }), lado({ '4.1.1.2.001': '1000.00', '4.1.1.3.001': '300.00', '4.1.1.5.005': '50.00' }));
    expect(c.novas.map((d) => d.conta)).toEqual(['4.1.1.10.001']);
    expect(c.retiradas.map((d) => [d.conta, d.diferenca.paraString()])).toEqual([['4.1.1.3.001', '-300.00']]);
    expect(c.alteradas.map((d) => [d.conta, d.diferenca.paraString(), d.percentual?.paraString()])).toEqual([['4.1.1.2.001', '100.00', '10.00']]);
    expect(c.total.diferenca.paraString()).toBe('-100.00');
    expect(c.atencao).toContain('Conta 4.1.1.10.001 nova (R$ 100,00).');
    expect(c.atencao).toContain('Conta 4.1.1.3.001 retirada (era R$ 300,00).');
    expect(c.atencao.some((a) => a.includes('4.1.1.2.001'))).toBe(false);
  });

  it('as faixas: conta acima de 20% e Valor Global acima de 10% viram ponto de atenção, o total primeiro', () => {
    const c = compararVersoes(lado({ '4.1.1.2.001': '1300.00' }), lado({ '4.1.1.2.001': '1000.00' }));
    expect(c.atencao).toEqual(['O Valor Global variou 30,00% (+ R$ 300,00).', 'Conta 4.1.1.2.001 variou 30,00% (+ R$ 300,00).']);
    expect(compararVersoes(lado({ '4.1.1.2.001': '1200.00' }), lado({ '4.1.1.2.001': '1000.00' })).atencao).toEqual(['O Valor Global variou 20,00% (+ R$ 200,00).']);
  });

  it('anterior zerada: sem divisão por zero, a conta é nova e o total não vira atenção (Review Focus 4)', () => {
    const c = compararVersoes(lado({ '4.1.1.2.001': '10.00' }), lado({}));
    expect(c.total.percentual).toBeNull();
    expect(c.novas).toHaveLength(1);
    expect(c.atencao).toEqual(['Conta 4.1.1.2.001 nova (R$ 10,00).']);
  });

  it('centavos em Dinheiro, rateio e tetos com a diferença, e o sinal explícito (Review Focus 5)', () => {
    const c = compararVersoes(
      lado({ '4.1.1.2.001': '0.10' }, { rateio: R('700.00'), tetos: R('10000.00') }),
      lado({ '4.1.1.2.001': '0.30' }, { rateio: R('1000.00'), tetos: R('10000.00') }),
    );
    expect(c.alteradas[0]!.diferenca.paraString()).toBe('-0.20');
    expect(c.rateio.diferenca.paraString()).toBe('-300.00');
    expect(c.tetos.diferenca.ehZero()).toBe(true);
    expect(comSinal(R('-0.20'))).toBe('- R$ 0,20');
    expect(comSinal(R('5.00'))).toBe('+ R$ 5,00');
  });

  it('versões iguais: nada mudou', () => {
    const c = compararVersoes(lado({ '4.1.1.2.001': '1.00' }), lado({ '4.1.1.2.001': '1.00' }));
    expect([c.novas, c.retiradas, c.alteradas, c.atencao]).toEqual([[], [], [], []]);
  });
});
