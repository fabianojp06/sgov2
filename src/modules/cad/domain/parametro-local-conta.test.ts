import { describe, expect, it } from 'vitest';
import { Percentual } from '@/shared/kernel';
import { faixasDaConta, validarParametroLocal } from './parametro-local-conta';

const faixas = (v: string, a: string, l: string) => ({ verdeAte: v, amareloAte: a, laranjaAte: l });

describe('validarParametroLocal (US-045)', () => {
  it('natureza OPEX/CAPEX ou nenhuma; sem faixas próprias', () => {
    expect(validarParametroLocal({ natureza: 'OPEX', semaforo: null })).toEqual({ ok: true, valor: { natureza: 'OPEX', semaforo: null } });
    expect(validarParametroLocal({ natureza: '', semaforo: null })).toEqual({ ok: true, valor: { natureza: null, semaforo: null } });
    expect(validarParametroLocal({ natureza: 'RECEITA', semaforo: null })).toMatchObject({ ok: false, erros: [{ campo: 'natureza' }] });
  });

  it('faixas próprias com vírgula ou ponto, em ordem, de 0 a 999', () => {
    const r = validarParametroLocal({ natureza: null, semaforo: faixas('60', '80,5', '90') });
    expect(r.ok && r.valor.semaforo?.amareloAte.comoFracao().toString()).toBe('0.805');
    expect(validarParametroLocal({ natureza: null, semaforo: faixas('0', '1', '999') }).ok).toBe(true);
  });

  it.each([
    ['fora de ordem', faixas('85', '70', '95'), 'semaforo'],
    ['iguais', faixas('70', '70', '95'), 'semaforo'],
    ['acima de 999', faixas('70', '85', '999.01'), 'semaforo.laranjaAte'],
    ['negativa', faixas('-1', '85', '95'), 'semaforo.verdeAte'],
    ['texto', faixas('70', 'x', '95'), 'semaforo.amareloAte'],
  ])('recusa faixas %s', (_, s, campo) => {
    expect(validarParametroLocal({ natureza: null, semaforo: s })).toMatchObject({ ok: false, erros: [{ campo }] });
  });

  it('faixasDaConta: as próprias valem sobre as do exercício; sem elas, as do exercício', () => {
    const exercicio = { verdeAte: Percentual.dePontos('70'), amareloAte: Percentual.dePontos('85'), laranjaAte: Percentual.dePontos('95') };
    const proprias = { verdeAte: Percentual.dePontos('50'), amareloAte: Percentual.dePontos('60'), laranjaAte: Percentual.dePontos('70') };
    expect(faixasDaConta(proprias, exercicio)).toBe(proprias);
    expect(faixasDaConta(null, exercicio)).toBe(exercicio);
  });
});
