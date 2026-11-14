import { describe, expect, it } from 'vitest';
import { ehPapel, gravarClassificacoes, lerClassificacoes } from './contas-relatorio';

// Contas dos relatórios (US-097): o texto gravado no parametro_sistema.
describe('contas dos relatórios', () => {
  it('grava sem repetição, sem vazios e em ordem de classificação; lê de volta', () => {
    const v = gravarClassificacoes(['4.1.10', ' 4.1.2 ', '', '4.1.2']);
    expect(v).toBe('4.1.2,4.1.10');
    expect(lerClassificacoes(v)).toEqual(['4.1.2', '4.1.10']);
    expect(lerClassificacoes('')).toEqual([]);
  });

  it('só os papéis conhecidos', () => {
    expect(ehPapel('viagens')).toBe(true);
    expect(ehPapel('imobilizado')).toBe(true);
    expect(ehPapel('outro')).toBe(false);
    expect(ehPapel(undefined)).toBe(false);
  });
});
