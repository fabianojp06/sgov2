import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { calcularPainel, validarTeto } from './resultado';

// Teto, uso e resultado do exercício (US-059; plano do P6, Task 7; spec §6.6).
const m12 = (v: string) => Array.from({ length: 12 }, () => Dinheiro.de(v));
const confirmada = { situacao: 'CONFIRMADO' as const, meses: m12('100000') };
const prevista = { situacao: 'PREVISTO' as const, meses: m12('50000') };
const s = (d: Dinheiro) => d.paraString();

describe('calcularPainel', () => {
  it('resultado = receita confirmada − despesas, mês a mês e no ano; a prevista fica fora', () => {
    const p = calcularPainel(m12('90000'), [confirmada, prevista], null);
    expect(p.resultadoMes.map(s)).toEqual(Array(12).fill('10000.00'));
    expect(s(p.resultadoAno)).toBe('120000.00');
    expect(p.receitaPrevistaMes.map(s)).toEqual(Array(12).fill('50000.00'));
    expect(s(p.tetoPadrao)).toBe('1200000.00');
    expect(s(p.tetoEfetivo)).toBe('1200000.00');
    expect(s(p.orcado)).toBe('1080000.00');
    expect(p.uso?.paraString()).toBe('90.00');
    expect(s(p.saldo)).toBe('120000.00');
  });

  it('teto manual menor: uso 108 e saldo negativo', () => {
    const p = calcularPainel(m12('90000'), [confirmada], Dinheiro.de('1000000'));
    expect(s(p.tetoEfetivo)).toBe('1000000.00');
    expect(p.uso?.paraString()).toBe('108.00');
    expect(s(p.saldo)).toBe('-80000.00');
  });

  it('sem receita confirmada e sem teto manual: teto 0 e uso nulo', () => {
    const p = calcularPainel(m12('90000'), [prevista], null);
    expect(s(p.tetoEfetivo)).toBe('0.00');
    expect(p.uso).toBeNull();
    expect(s(p.resultadoAno)).toBe('-1080000.00');
  });
});

describe('validarTeto', () => {
  const receita = Dinheiro.de('1200000');
  it('zero ou negativo: erro', () => {
    expect(validarTeto(Dinheiro.de('0'), null, receita)).toEqual({ ok: false, erros: [{ campo: 'teto', mensagem: 'O teto precisa ser maior que zero.' }] });
    expect(validarTeto(Dinheiro.de('-1'), null, receita).ok).toBe(false);
  });

  it('acima da receita confirmada: justificativa de pelo menos 15 caracteres (D-P6-2)', () => {
    const acima = Dinheiro.de('1300000');
    const erro = { ok: false, erros: [{ campo: 'justificativa', mensagem: 'Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres.' }] };
    expect(validarTeto(acima, null, receita)).toEqual(erro);
    expect(validarTeto(acima, '  14 caractere ', receita)).toEqual(erro);
    expect(validarTeto(acima, 'Quinze letras!!', receita)).toEqual({ ok: true, valor: { valor: acima, justificativa: 'Quinze letras!!' } });
    expect(validarTeto(acima, '🚀'.repeat(8), receita)).toEqual(erro); // 8 caracteres, 16 unidades UTF-16
  });

  it('até a receita (inclusive igual): sem justificativa, e a informada é guardada; null limpa o teto manual', () => {
    expect(validarTeto(Dinheiro.de('1000000'), '', receita)).toEqual({ ok: true, valor: { valor: Dinheiro.de('1000000'), justificativa: null } });
    expect(validarTeto(Dinheiro.de('1200000'), null, receita).ok).toBe(true);
    expect(validarTeto(Dinheiro.de('1000000'), ' motivo ', receita)).toEqual({ ok: true, valor: { valor: Dinheiro.de('1000000'), justificativa: 'motivo' } });
    expect(validarTeto(null, 'qualquer', receita)).toEqual({ ok: true, valor: { valor: null, justificativa: null } });
  });
});
