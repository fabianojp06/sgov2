import { describe, expect, it } from 'vitest';
import { mascararHistoricoOrc, VALOR_MASCARADO } from './mascara-historico';

// Máscara do salário das posições no Histórico (US-056; plano do P12, D-P12-4).
const posicao = { cc: '4.3.0', cargo: 'Analista', quantidade: 1, salarioMensal: '7500.00', mesInicio: 1, mesSaida: 12, observacao: null };

describe('mascararHistoricoOrc', () => {
  it('sem a permissão: o salário vira VALOR_MASCARADO, em qualquer profundidade; o resto fica', () => {
    const r = mascararHistoricoOrc('orc.posicoes', { ...posicao, versaoPremissas: 2, outras: [{ salarioMensal: '1.00' }] }, false);
    expect(r).toEqual({
      dados: { ...posicao, salarioMensal: '•••', versaoPremissas: 2, outras: [{ salarioMensal: '•••' }] },
      mascarado: true,
      contemSalario: true,
    });
    expect(VALOR_MASCARADO).toBe('•••');
  });

  it('com a permissão: os dados como estão (a mesma referência), informando que havia salário', () => {
    const r = mascararHistoricoOrc('orc.posicoes', posicao, true);
    expect(r.dados).toBe(posicao);
    expect(r).toMatchObject({ mascarado: false, contemSalario: true });
  });

  it('salário nulo continua nulo; funcionalidade sem salário não muda nada', () => {
    expect(mascararHistoricoOrc('orc.posicoes', { salarioMensal: null }, false)).toEqual({ dados: { salarioMensal: null }, mascarado: false, contemSalario: false });
    const pacote = { valorUnitario: '10.00', salarioMensal: '1.00' };
    expect(mascararHistoricoOrc('orc.pacotes', pacote, false)).toEqual({ dados: pacote, mascarado: false, contemSalario: false });
    expect(mascararHistoricoOrc('orc.posicoes', null, false)).toEqual({ dados: null, mascarado: false, contemSalario: false });
  });
});
