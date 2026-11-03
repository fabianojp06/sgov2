import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { rotuloCc, VisaoCc, type DadosVisao } from './visao-cc';

// Tela da visão por centro de custo (US-058; plano do P6, Task 6).
const d = (v: string) => Dinheiro.de(v);
const m12 = (v: string) => Array.from({ length: 12 }, () => d(v));
const no = (cc: string, reduzido: string, descricao: string, total: string, filhos: DadosVisao['arvore'] = [], inativo = false) => ({
  cc, codigoReduzido: reduzido, descricao, inativo, pessoal: d(total), baseZero: d('0'), total: d(total), percentualDoEscopo: Percentual.dePontos('50'), filhos,
});
const visao = (p: Partial<DadosVisao> = {}): DadosVisao => ({
  exercicio: { id: 'e1', ano: 2027, rotuloSituacao: 'Em Elaboração', editavel: true, versao: 3 },
  painel: null,
  escopo: { tipo: 'TOTAL' },
  arvore: [no('4', '14.180', 'DIREX', '1000.00', [no('4.4', '14.450', 'Suporte Administrativo', '500.00', [], true)])],
  indicadores: {
    orcamentoAno: d('215389.00'),
    pessoal: d('210000.00'),
    percentualPessoal: Percentual.dePontos('97.5'),
    pacotes: 2,
    empregadosDezembro: 2,
    porPrioridade: { ESSENCIAL: d('1000'), IMPORTANTE: d('4389'), DESEJAVEL: d('0') },
  },
  detalhe: null,
  avisos: [],
  ...p,
});
const html = (v: DadosVisao, podeRecalcular = true, aviso?: string) =>
  renderToString(createElement(VisaoCc, { visao: v, podeRecalcular, recalcular: async () => ({ ok: true as const, valor: undefined }), aviso }));

describe('VisaoCc', () => {
  it('indicadores do escopo e a árvore com reduzido, link do detalhe e o inativo marcado', () => {
    const h = html(visao());
    expect(h).toContain('R$ 215.389,00');
    expect(h).toContain('2 pacote(s)');
    expect(h).toContain('Empregados em dezembro');
    expect(h).toContain('Importante R$ 4.389,00');
    expect(h).toContain('role="treegrid"');
    expect(h).toContain('14.180 · 4 DIREX');
    expect(h).toContain('href="/orc/orcamento?ano=2027&amp;cc=4#detalhe-cc"');
    expect(h).toContain('(Inativo)');
  });

  it('rótulo do CC: reduzido, classificação e o selo de inativo', () => {
    expect(rotuloCc({ cc: '4.4', codigoReduzido: '14.450', descricao: 'Suporte', inativo: true })).toBe('14.450 · 4.4 Suporte (Inativo)');
    expect(rotuloCc({ cc: '9.9', codigoReduzido: '', descricao: '(CC fora da estrutura)', inativo: true })).toBe('9.9 (CC fora da estrutura) (Inativo)');
  });

  it('detalhe com a série mês a mês e as linhas CC × conta com a origem', () => {
    const h = html(
      visao({
        detalhe: {
          cc: '4.3',
          codigoReduzido: '14.310',
          descricao: 'Diretoria',
          serie: { pessoal: m12('15000'), baseZero: m12('365.75'), total: m12('15365.75') },
          linhas: [
            { conta: '4.1.1.5.005', descricaoConta: 'Material', origem: 'BASE_ZERO', meses: m12('365.75'), total: d('4389') },
            { conta: '4.1.1.1.001', descricaoConta: 'Salários', origem: 'PESSOAL', meses: m12('15000'), total: d('180000') },
          ],
        },
      }),
    );
    expect(h).toContain('Detalhe: 14.310 · 4.3 Diretoria');
    expect(h).toContain('aria-labelledby="tabela-serie"');
    expect(h).toContain('id="tabela-serie"');
    expect(h).toContain('Base zero · 4.1.1.5.005 Material');
    expect(h).toContain('Pessoal · 4.1.1.1.001 Salários');
    expect(h).toContain('180.000,00');
    expect(h).toContain('<abbr title="Janeiro">Jan</abbr>');
  });

  it('Recalcular só quando a página permite; avisos e o aviso do recálculo em role=status; somente leitura', () => {
    expect(html(visao())).toContain('Recalcular');
    expect(html(visao(), false)).not.toContain('Recalcular');
    const h = html(visao({ avisos: ['As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.'] }), true, 'O orçamento foi recalculado.');
    expect(h).toMatch(/<div role="status"><p>O orçamento foi recalculado\.<\/p><p>As premissas/);
    expect(html(visao({ exercicio: { id: 'e1', ano: 2027, rotuloSituacao: 'Em Aprovação', editavel: false, versao: 3 } }))).toContain('Situação: Em Aprovação (somente leitura)');
  });

  it('escopo de subárvore: indicadores com a raiz; árvore vazia com o texto próprio', () => {
    const h = html(visao({ escopo: { tipo: 'SUBARVORE', raiz: '4.3' }, arvore: [] }));
    expect(h).toContain('Indicadores do escopo (4.3)');
    expect(h).toContain('Nenhum centro de custo no seu escopo.');
  });
});
