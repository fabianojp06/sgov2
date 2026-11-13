import { describe, expect, it } from 'vitest';
import { MSG_MINIMO, validarAgrupador } from './agrupadores';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('validarAgrupador (RN_PLA_008)', () => {
  it('aceita nome e duas contas, sem espaço nas pontas e sem conta repetida', () => {
    expect(validarAgrupador({ nome: '  Passagens aéreas ', contaIds: [A, B, A.toUpperCase()] })).toEqual({ ok: true, valor: { nome: 'Passagens aéreas', contaIds: [A, B] } });
  });

  it('recusa nome em branco ou menos de duas contas (contando a repetida uma vez só)', () => {
    expect(validarAgrupador({ nome: ' ', contaIds: [A, B] })).toEqual({ ok: false, erros: [{ campo: 'nome', mensagem: MSG_MINIMO }] });
    expect(validarAgrupador({ nome: 'X', contaIds: [A, A] })).toEqual({ ok: false, erros: [{ campo: 'contas', mensagem: MSG_MINIMO }] });
  });

  it('recusa nome longo e conta que não é id', () => {
    const r = validarAgrupador({ nome: 'x'.repeat(101), contaIds: [A, 'abc'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.campo)).toEqual(['nome', 'contas']);
  });
});
