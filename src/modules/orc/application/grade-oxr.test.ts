import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { celulaOxr, mesOxr, montarGradeOxr, type NoPlanoOxr } from './grade-oxr';

// Os critérios de aceite do OxR V2 (seção 6) com os valores reais do documento.
const no = (classificacao: string, descricao: string, filhos: NoPlanoOxr[] = [], ativa = true): NoPlanoOxr => ({
  classificacao,
  descricao,
  nivel: classificacao.split('.').length,
  tipo: classificacao.split('.').length === 5 ? 'ANALITICA' : 'SINTETICA',
  ativa,
  filhos,
});
const PLANO = [
  no('4', 'DESPESAS', [
    no('4.1', 'OPERACIONAIS', [
      no('4.1.1', 'SERVIÇOS', [
        no('4.1.1.1', 'DESPESAS DE PESSOAL', [no('4.1.1.1.001', 'Salários'), no('4.1.1.1.003', 'Férias'), no('4.1.1.1.008', 'Seguro saúde'), no('4.1.1.1.009', 'Vale-Refeição'), no('4.1.1.1.010', 'Vale-transporte'), no('4.1.1.1.013', 'Plano Odontológico')]),
        no('4.1.1.5', 'ADMINISTRATIVAS', [no('4.1.1.5.005', 'Material'), no('4.1.1.5.009', 'Conta antiga', [], false)]),
      ]),
    ]),
  ]),
];
const d = (v: string) => Dinheiro.de(v);
const mapa = (xs: [string, string, string][]) => new Map(xs.map(([c, m, v]) => [`${c}|${m}`, d(v)]));

describe('celulaOxr', () => {
  it('AC02: Set/18 Orçado 704.831,00 e Realizado 569.413,56 dão 80,79%', () => {
    const c = celulaOxr(d('704831.00'), d('569413.56'));
    expect([c.uso?.formatar(), c.estouro, c.semOrcamento]).toEqual(['80,79%', false, false]);
  });
  it('AC03: Out/18 Orçado 540.656,00 e Realizado 713.183,14 dão 131,91%, com estouro (RN0314)', () => {
    const c = celulaOxr(d('540656.00'), d('713183.14'));
    expect([c.uso?.formatar(), c.estouro]).toEqual(['131,91%', true]);
  });
  it('RN_OXR_012: orçado zero com realizado é "Sem orçamento", sem %; os dois zero, sem nada', () => {
    expect([celulaOxr(Dinheiro.zero(), d('10')).semOrcamento, celulaOxr(Dinheiro.zero(), d('10')).uso]).toEqual([true, null]);
    expect(celulaOxr(Dinheiro.zero(), Dinheiro.zero()).semOrcamento).toBe(false);
  });
});

describe('montarGradeOxr', () => {
  it('AC01: a sintética 4.1.1.1 soma as 6 analíticas de Jun/22: 546.195,02', () => {
    const real = mapa([
      ['4.1.1.1.001', '2022-06', '301922.05'],
      ['4.1.1.1.003', '2022-06', '50148.86'],
      ['4.1.1.1.008', '2022-06', '101916.93'],
      ['4.1.1.1.009', '2022-06', '80813.67'],
      ['4.1.1.1.010', '2022-06', '7083.48'],
      ['4.1.1.1.013', '2022-06', '4310.03'],
    ]);
    const g = montarGradeOxr(PLANO, ['2022-06'], new Map(), real, { zeradas: false });
    expect(g.linhas.find((l) => l.conta === '4.1.1.1')?.meses[0]?.realizado.paraString()).toBe('546195.02');
  });

  it('AC04: Set–Out/18, total do período 1.245.487,00 × 1.282.596,70 = 102,98%, saldo −37.109,70', () => {
    const orc = mapa([['4.1.1.1.001', '2018-09', '704831.00'], ['4.1.1.1.001', '2018-10', '540656.00']]);
    const real = mapa([['4.1.1.1.001', '2018-09', '569413.56'], ['4.1.1.1.001', '2018-10', '713183.14']]);
    const g = montarGradeOxr(PLANO, ['2018-09', '2018-10'], orc, real, { zeradas: false });
    const p = g.linhas.find((l) => l.conta === '4.1.1.1')!.periodo;
    expect([p.orcado.paraString(), p.realizado.paraString(), p.uso?.formatar(), p.saldo.paraString(), p.estouro]).toEqual(['1245487.00', '1282596.70', '102,98%', '-37109.70', true]);
    expect(g.total.periodo.saldo.paraString()).toBe('-37109.70');
  });

  it('RN_OXR_013: sem as zeradas, só as contas com valor no período (e as sintéticas acima); com elas, o plano inteiro', () => {
    const orc = mapa([['4.1.1.5.005', '2026-01', '100']]);
    const sem = montarGradeOxr(PLANO, ['2026-01'], orc, new Map(), { zeradas: false });
    expect(sem.linhas.map((l) => l.conta)).toEqual(['4', '4.1', '4.1.1', '4.1.1.5', '4.1.1.5.005']);
    expect(montarGradeOxr(PLANO, ['2026-01'], orc, new Map(), { zeradas: true }).linhas).toHaveLength(13);
  });

  it('o filtro de conta mostra a subárvore e o total é o dela; meses fora do período não entram; conta inativa aparece marcada', () => {
    const real = mapa([['4.1.1.5.009', '2026-02', '30'], ['4.1.1.1.001', '2026-02', '70'], ['4.1.1.5.009', '2026-05', '999']]);
    const g = montarGradeOxr(PLANO, ['2026-01', '2026-02'], new Map(), real, { zeradas: false, conta: '4.1.1.5' });
    expect(g.linhas.map((l) => [l.conta, l.inativa, l.periodo.realizado.paraString()])).toEqual([
      ['4.1.1.5', false, '30.00'],
      ['4.1.1.5.009', true, '30.00'],
    ]);
    expect(g.total.meses.map((c) => c.realizado.paraString())).toEqual(['0.00', '30.00']);
  });

  it('valor em conta fora do plano vai à lista à parte, sem quebrar a totalização', () => {
    const g = montarGradeOxr(PLANO, ['2026-01'], mapa([['9.9.9.9.999', '2026-01', '5']]), new Map(), { zeradas: false });
    expect(g.foraDoPlano.map((f) => [f.conta, f.orcado.paraString()])).toEqual([['9.9.9.9.999', '5.00']]);
  });

  it('RN0302: o mês como Mmm/AA', () => expect([mesOxr('2022-06'), mesOxr('2018-10')]).toEqual(['Jun/22', 'Out/18']));
});
