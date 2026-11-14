import { describe, expect, it } from 'vitest';
import { CONTAS_EXEMPLO, type NoConta } from '@/modules/cad';
import { Dinheiro } from '@/shared/kernel';
import { colunasDoPeriodo, mesPorExtenso, montarDespesas } from './despesas-tp-montagem';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02): colunas, hierarquia, totalização, zerados e inativas.
const l = (conta: string, competencia: string, valor: string) => ({ conta, competencia, valor: Dinheiro.de(valor) });
const op = (exibirZerados = false, anoAtual = 2027) => ({ exibirZerados, anoAtual });

describe('colunasDoPeriodo', () => {
  it('ano de referência = ano atual dentro do período: antes, uma coluna; no ano, os meses (futuros inclusos); depois, uma coluna', () => {
    expect(colunasDoPeriodo('2025-09', '2028-06', 2027).map((c) => [c.rotulo, c.de, c.ate])).toEqual([
      ['set/2025 a dez/2026', '2025-09', '2026-12'],
      ...['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, i) => [`${m}/27`, `2027-${String(i + 1).padStart(2, '0')}`, `2027-${String(i + 1).padStart(2, '0')}`]),
      ['jan/2028 a jun/2028', '2028-01', '2028-06'],
    ]);
    // Ano atual fora do período: o mais próximo (TP encerrado ou futuro).
    expect(colunasDoPeriodo('2025-03', '2025-05', 2027).map((c) => c.rotulo)).toEqual(['Mar/25', 'Abr/25', 'Mai/25']);
    expect(colunasDoPeriodo('2029-01', '2029-02', 2027).map((c) => c.rotulo)).toEqual(['Jan/29', 'Fev/29']);
    expect(colunasDoPeriodo('2027-06', '2027-05', 2027)).toEqual([]);
    expect(mesPorExtenso('2026-09')).toBe('Setembro/2026');
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
    l('4.1.1.1', '2027-01', '3.00'), // sintética: fora
  ];

  it('hierarquia, ordem e totalização; total por linha e geral; o que não é analítica de despesa vai para "fora", com valor', () => {
    const d = montarDespesas(CONTAS_EXEMPLO, linhas, '2026-09', '2027-02', op());
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
    expect(d.foraDaArvore).toEqual({ quantidade: 2, valor: '10.00' });
  });

  it('revisão 12.12: conta INATIVA com realizado entra no total e aparece marcada; inativa sem valor nunca aparece', () => {
    const inativar = (nos: readonly NoConta[], alvo: string): NoConta[] =>
      nos.map((n) => ({ ...n, ativa: n.classificacao === alvo ? false : n.ativa, filhos: inativar(n.filhos, alvo) }));
    const arvore = inativar(inativar(CONTAS_EXEMPLO, '4.1.1.1.001'), '4.1.1.5.005');
    const d = montarDespesas(arvore, linhas, '2026-09', '2027-02', op(true));
    expect(d.totalGeral.total).toBe('185.50');
    expect(d.linhas.find((x) => x.classificacao === '4.1.1.1.001')).toMatchObject({ inativa: true, total: '150.00' });
    expect(d.linhas.some((x) => x.classificacao === '4.1.1.5.005')).toBe(false);
  });

  it('zerados: com a opção, as ativas sem valor aparecem (RN0383); sem ela, a sintética só some se tudo abaixo sumir', () => {
    expect(montarDespesas(CONTAS_EXEMPLO, linhas, '2026-09', '2027-02', op(true)).linhas.map((x) => x.classificacao)).toContain('4.1.1.5.005');
    // Estorno que se anula no período: a analítica com valores (+100 e −100) aparece, e a sintética acima também.
    const estorno = [l('4.1.1.2.001', '2027-01', '100.00'), l('4.1.1.2.001', '2027-02', '-100.00')];
    const d = montarDespesas(CONTAS_EXEMPLO, estorno, '2027-01', '2027-02', op());
    expect(d.linhas.map((x) => x.classificacao)).toEqual(['4', '4.1', '4.1.1', '4.1.1.2', '4.1.1.2.001']);
  });

  it('período inválido ou sem lançamento: vazio, com total zero', () => {
    expect(montarDespesas(CONTAS_EXEMPLO, linhas, '2027-05', '2027-01', op())).toMatchObject({ colunas: [], linhas: [] });
    expect(montarDespesas(CONTAS_EXEMPLO, [], '2027-01', '2027-02', op())).toMatchObject({ linhas: [], totalGeral: { total: '0.00' } });
  });
});
