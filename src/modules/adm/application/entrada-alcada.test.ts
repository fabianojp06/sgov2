import { describe, expect, it } from 'vitest';
import { entradaAlteracaoAlcada, entradaCadastroAlcada, entradaExclusaoAlcada } from './entrada-alcada';

// Conversão do FormData das telas das alçadas (US-042).
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe('entradas das alçadas', () => {
  it('cadastro: fluxo e aprovadores como texto; campo ausente vira vazio', () => {
    expect(entradaCadastroAlcada.parse(form({ fluxo: 'WA01', titularId: 'a' }))).toEqual({ fluxo: 'WA01', titularId: 'a', substitutoId: '' });
  });

  it('alteração e exclusão: versão numérica; versão fora do formato é recusada', () => {
    expect(entradaAlteracaoAlcada.parse(form({ id: 'x', versao: '3', titularId: 'a', substitutoId: 'b' }))).toEqual({ id: 'x', versao: 3, dados: { titularId: 'a', substitutoId: 'b' } });
    expect(entradaExclusaoAlcada.parse(form({ id: 'x', versao: '2' }))).toEqual({ id: 'x', versao: 2 });
    expect(entradaExclusaoAlcada.safeParse(form({ id: 'x', versao: '-1' })).success).toBe(false);
    expect(entradaAlteracaoAlcada.safeParse(form({ id: 'x', versao: '1e3' })).success).toBe(false);
  });
});
