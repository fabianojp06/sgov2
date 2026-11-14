import { describe, expect, it } from 'vitest';
import { chaveInativos, inativosSalvos, textoInativos } from './inativos-sessao';

describe('"Mostrar inativos" retido na sessão (#245)', () => {
  it('lê o que esta sessão gravou; outra sessão, ausente ou corrompido → false', () => {
    expect(chaveInativos('cad.plano')).toBe('sgo.grade.cad.plano.inativos');
    expect(inativosSalvos(textoInativos('s1', true), 's1')).toBe(true);
    expect(inativosSalvos(textoInativos('s1', false), 's1')).toBe(false);
    expect(inativosSalvos(textoInativos('s1', true), 's2')).toBe(false);
    expect(inativosSalvos(null, 's1')).toBe(false);
    expect(inativosSalvos('{x', 's1')).toBe(false);
    expect(inativosSalvos(JSON.stringify({ escopo: 's1', valores: { inativos: 'sim' } }), 's1')).toBe(false);
  });
});
