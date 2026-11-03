import { describe, expect, it } from 'vitest';
import { Dinheiro, ErroDominio, Percentual } from '@/shared/kernel';
import { calcularPacote, type DadosPacote } from './pacote';

const pacote = (p: Partial<DadosPacote> & Pick<DadosPacote, 'quantidade' | 'valorUnitario'>): DadosPacote => ({
  corrigirIpca: false,
  distribuicao: 'MENSAL',
  mesOcorrencia: null,
  ...p,
});
const quatro = Percentual.dePontos('4');
const texto = (xs: readonly Dinheiro[]) => xs.map((x) => x.paraString());

// R4 do plano do P6: anual = (quantidade × valor unitário) × (1 + IPCA), com um Half-Even no fim.
describe('calcularPacote', () => {
  it('12 × 350,00 com IPCA de 4%, mensal → 4.368,00 e 364,00 por mês', () => {
    const r = calcularPacote(pacote({ quantidade: 12, valorUnitario: Dinheiro.de('350.00'), corrigirIpca: true }), quatro);
    expect(r.valorAnual.paraString()).toBe('4368.00');
    expect(texto(r.meses)).toEqual(Array(12).fill('364.00'));
  });

  it('1 × 1.000,00 com IPCA de 4%, mensal → 86,67 de janeiro a novembro e 86,63 em dezembro', () => {
    const r = calcularPacote(pacote({ quantidade: 1, valorUnitario: Dinheiro.de('1000.00'), corrigirIpca: true }), quatro);
    expect(r.valorAnual.paraString()).toBe('1040.00');
    expect(texto(r.meses)).toEqual([...Array(11).fill('86.67'), '86.63']);
    expect(Dinheiro.somarTodos(r.meses).paraString()).toBe('1040.00');
  });

  it('3 × 99,99 sem IPCA, pontual em julho → 299,97 só em julho', () => {
    const r = calcularPacote(
      pacote({ quantidade: 3, valorUnitario: Dinheiro.de('99.99'), distribuicao: 'PONTUAL', mesOcorrencia: 7 }),
      quatro,
    );
    expect(r.valorAnual.paraString()).toBe('299.97');
    expect(texto(r.meses)).toEqual([...Array(6).fill('0.00'), '299.97', ...Array(5).fill('0.00')]);
  });

  it('Half-Even no empate: 0,525 → 0,52 e 2,625 → 2,62 (Half-Up daria 0,53 e 2,63)', () => {
    const cinco = Percentual.dePontos('5');
    const anual = (v: string) => calcularPacote(pacote({ quantidade: 1, valorUnitario: Dinheiro.de(v), corrigirIpca: true }), cinco).valorAnual;
    expect(anual('0.50').paraString()).toBe('0.52');
    expect(anual('2.50').paraString()).toBe('2.62');
  });

  it('pontual sem mês ou mensal com mês: erro de programação (a validação de entrada é da Task 4a)', () => {
    const v = Dinheiro.de('10.00');
    expect(() => calcularPacote(pacote({ quantidade: 1, valorUnitario: v, distribuicao: 'PONTUAL', mesOcorrencia: null }), quatro)).toThrow(
      expect.objectContaining({ codigo: 'orc.pacote_invalido' }),
    );
    expect(() => calcularPacote(pacote({ quantidade: 1, valorUnitario: v, mesOcorrencia: 3 }), quatro)).toThrow(ErroDominio);
  });
});
