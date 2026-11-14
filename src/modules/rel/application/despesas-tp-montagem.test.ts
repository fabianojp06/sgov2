import { describe, expect, it } from 'vitest';
import { CONTAS_EXEMPLO } from '@/modules/cad';
import { Dinheiro } from '@/shared/kernel';
import { colunasDoPeriodo, montarDespesas } from './despesas-tp-montagem';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02): colunas, hierarquia, totalização e zerados.
const l = (conta: string, competencia: string, valor: string) => ({ conta, competencia, valor: Dinheiro.de(valor) });

describe('colunasDoPeriodo', () => {
  it('antes do ano de referência, uma coluna só ("set/2025 a dez/2026"); no ano, um mês por coluna até o fim', () => {
    expect(colunasDoPeriodo('2025-09', '2027-03').map((c) => [c.rotulo, c.de, c.ate])).toEqual([
      ['set/2025 a dez/2026', '2025-09', '2026-12'],
      ['Jan/27', '2027-01', '2027-01'],
      ['Fev/27', '2027-02', '2027-02'],
      ['Mar/27', '2027-03', '2027-03'],
    ]);
    expect(colunasDoPeriodo('2027-05', '2027-06').map((c) => c.rotulo)).toEqual(['Mai/27', 'Jun/27']);
    expect(colunasDoPeriodo('2027-06', '2027-05')).toEqual([]);
    expect(colunasDoPeriodo('2027-13', '2027-05')).toEqual([]);
  });
});

describe('montarDespesas', () => {
  const linhas = [
    l('4.1.1.1.001', '2026-10', '100.00'),
    l('4.1.1.1.001', '2027-01', '50.00'),
    l('4.1.1.1.003', '2027-02', '25.50'),
    l('4.1.1.2.001', '2027-02', '10.00'),
    l('4.1.1.2.001', '2028-01', '999.00'), // fora do período
    l('9.9.9', '2027-01', '7.00'), // fora da árvore de despesas
  ];

  it('hierarquia DESPESAS → sintéticas → analíticas, na ordem; sintéticas somam; total por linha e geral', () => {
    const d = montarDespesas(CONTAS_EXEMPLO, linhas, '2026-09', '2027-02', { exibirZerados: false });
    expect(d.colunas.map((c) => c.rotulo)).toEqual(['set/2026 a dez/2026', 'Jan/27', 'Fev/27']);
    expect(d.linhas.map((x) => [x.classificacao, x.nivel, x.valores, x.total])).toEqual([
      ['4', 0, ['100.00', '50.00', '35.50'], '185.50'],
      ['4.1', 1, ['100.00', '50.00', '35.50'], '185.50'],
      ['4.1.1', 2, ['100.00', '50.00', '35.50'], '185.50'],
      ['4.1.1.1', 3, ['100.00', '50.00', '25.50'], '175.50'],
      ['4.1.1.1.001', 4, ['100.00', '50.00', '0.00'], '150.00'],
      ['4.1.1.1.003', 4, ['0.00', '0.00', '25.50'], '25.50'],
      ['4.1.1.2', 3, ['0.00', '0.00', '10.00'], '10.00'],
      ['4.1.1.2.001', 4, ['0.00', '0.00', '10.00'], '10.00'],
    ]);
    expect(d.totalGeral).toEqual({ valores: ['100.00', '50.00', '35.50'], total: '185.50' });
    expect(d.foraDaArvore).toBe(1);
  });

  it('com "exibir zerados", aparecem também as contas sem lançamento (RN0383)', () => {
    const d = montarDespesas(CONTAS_EXEMPLO, linhas, '2026-09', '2027-02', { exibirZerados: true });
    expect(d.linhas.map((x) => x.classificacao)).toContain('4.1.1.5.005');
    expect(d.linhas.find((x) => x.classificacao === '4.1.1.1.005')).toMatchObject({ total: '0.00', analitica: true });
  });

  it('período inválido ou sem lançamento: vazio, com total zero', () => {
    expect(montarDespesas(CONTAS_EXEMPLO, linhas, '2027-05', '2027-01', { exibirZerados: false })).toMatchObject({ colunas: [], linhas: [] });
    expect(montarDespesas(CONTAS_EXEMPLO, [], '2027-01', '2027-02', { exibirZerados: false })).toMatchObject({ linhas: [], totalGeral: { total: '0.00' } });
  });
});
