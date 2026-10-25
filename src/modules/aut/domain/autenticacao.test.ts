import { describe, expect, it } from 'vitest';
import { avaliarAntesDaSenha, avaliarFalha } from './autenticacao';

const u = (ativo: boolean, bloqueado: boolean, ehAdministrador = false) => ({ ativo, bloqueado, ehAdministrador });

describe('avaliarAntesDaSenha: ordem do UC01.02 (manutenção → existência → status → bloqueio → senha)', () => {
  it.each([
    ['manutenção, não administrador', true, u(true, false), 'MANUTENCAO'],
    ['manutenção, login inexistente', true, null, 'MANUTENCAO'],
    ['manutenção, inativo', true, u(false, false), 'MANUTENCAO'],
    ['manutenção, administrador ativo', true, u(true, false, true), 'CONFERIR'],
    ['manutenção, administrador bloqueado', true, u(true, true, true), 'BLOQUEADO'],
    ['inexistente', false, null, 'INEXISTENTE'],
    ['inativo', false, u(false, false), 'INATIVO'],
    ['inativo e bloqueado', false, u(false, true), 'INATIVO'],
    ['ativo e bloqueado', false, u(true, true), 'BLOQUEADO'],
    ['ativo', false, u(true, false), 'CONFERIR'],
  ] as const)('%s → %s', (_caso, manutencao, usuario, esperado) =>
    expect(avaliarAntesDaSenha({ manutencao, usuario })).toBe(esperado));
});

describe('avaliarFalha (RN0024, RN0520, A5), limite 5 e limiar 3', () => {
  const f = (contador: number) => avaliarFalha({ contador, limite: 5, limiar: 3 });
  it('2 → 3, alerta', () => expect(f(2)).toEqual({ novoContador: 3, bloquear: false, alertar: true, ultimaTentativa: false }));
  it('3 → 4, última tentativa', () => expect(f(3)).toEqual({ novoContador: 4, bloquear: false, alertar: false, ultimaTentativa: true }));
  it('4 → 5, bloqueia', () => expect(f(4)).toEqual({ novoContador: 5, bloquear: true, alertar: false, ultimaTentativa: false }));
  it('0 → 1, nada', () => expect(f(0)).toEqual({ novoContador: 1, bloquear: false, alertar: false, ultimaTentativa: false }));
});
