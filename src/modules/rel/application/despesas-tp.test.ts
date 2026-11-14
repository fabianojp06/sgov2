import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONTAS_EXEMPLO, type NoConta } from '@/modules/cad';
import type { ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { TabelaDespesas, TEXTOS_DESPESAS } from '../ui/despesas-tp';
import { MENSAGENS_DESPESAS, obterDespesasTp, planilhaDespesas, type PortaRealizado } from './despesas-tp';

vi.mock('server-only', () => ({}));

// Demonstrativo de despesas do TP (US-096 parte 1): filtros, período padrão, só TP oficial e a tabela.
const perm = (a: string) => ['rel.despesas_tp', a].join(':');
const ctx = (acoes = ['consultar', 'exportar']): ContextoRequisicao => ({ usuarioId: 'u', usuarioRotulo: 'gfin', sessaoUid: 's', ip: null, unidadeId: null, permissoes: new Set(acoes.map(perm)) });
const TP = { numero: 'TP-3', objeto: 'Apoio à gestão', inicio: '2026-09', fim: '2028-12', versaoOficial: 2 };
const pedidos: unknown[] = [];
const porta: PortaRealizado = {
  tps: async () => [TP, { ...TP, numero: 'TP-RASCUNHO', versaoOficial: null }],
  realizado: async (_c, f) => (
    pedidos.push(f),
    {
      linhas: [
        { conta: '4.1.1.1.001', competencia: '2026-10', valor: Dinheiro.de('100.00') },
        { conta: '4.1.1.1.001', competencia: '2027-01', valor: Dinheiro.de('50.00') },
      ],
      ajustes: [{ conta: '4.1.1.1.001', origem: '2026-10', lancamento: '2027-01', valor: Dinheiro.de('5.00') }],
      pendencias: { quantidade: 2, valor: Dinheiro.de('30.00') },
      atualizadoEm: new Date('2027-02-03T15:00:00Z'),
    }
  ),
};
const deps = { agora: () => new Date('2027-02-10T12:00:00Z'), contas: async () => CONTAS_EXEMPLO as NoConta[] };

describe('obterDespesasTp', () => {
  it('sem TP, só a lista (RN0234), e só os TPs com versão oficial (RN0385)', async () => {
    const t = await obterDespesasTp(ctx(), {}, porta, deps);
    expect(t.tps.map((x) => x.numero)).toEqual(['TP-3']);
    expect(t.relatorio).toBeNull();
    expect(t.erro).toBeNull();
    expect((await obterDespesasTp(ctx(), { tp: 'TP-RASCUNHO' }, porta, deps)).erro).toBe(MENSAGENS_DESPESAS.TP_INEXISTENTE);
  });

  it('período padrão: a vigência até o mês atual (RN0294); fora da vigência ou invertido, recusa', async () => {
    const t = await obterDespesasTp(ctx(), { tp: 'TP-3' }, porta, deps);
    expect(pedidos.at(-1)).toEqual({ tp: 'TP-3', de: '2026-09', ate: '2027-02' });
    expect(t.relatorio).toMatchObject({ tp: { numero: 'TP-3' }, totalGeral: { total: '150.00' }, pendencias: { quantidade: 2, valor: '30.00' }, ajustes: 1 });
    expect(t.relatorio!.colunas.map((c) => c.rotulo)).toEqual(['set/2026 a dez/2026', 'Jan/27', 'Fev/27']);
    expect((await obterDespesasTp(ctx(), { tp: 'TP-3', de: '2026-01', ate: '2026-12' }, porta, deps)).erro).toBe(MENSAGENS_DESPESAS.FORA_DA_VIGENCIA);
    expect((await obterDespesasTp(ctx(), { tp: 'TP-3', de: '2027-05', ate: '2027-01' }, porta, deps)).erro).toBe(MENSAGENS_DESPESAS.PERIODO_INVALIDO);
    expect((await obterDespesasTp(ctx(), { tp: 'TP-3', de: 'x'.repeat(50) }, porta, deps)).erro).toBe(MENSAGENS_DESPESAS.PERIODO_INVALIDO);
  });

  it('sem a permissão, recusa', async () => {
    await expect(obterDespesasTp(ctx([]), {}, porta, deps)).rejects.toThrow();
  });

  it('a tabela: título do TP, recuo, sintética em negrito, total geral, pendências e ajustes; a planilha igual à tela', async () => {
    const t = await obterDespesasTp(ctx(), { tp: 'TP-3' }, porta, deps);
    const h = renderToStaticMarkup(createElement(TabelaDespesas, { relatorio: t.relatorio! }));
    expect(h).toContain('TP-3 – Apoio à gestão');
    expect(h).toContain('<strong>DESPESAS</strong>');
    expect(h).toContain('padding-left:5em');
    expect(h).toContain(TEXTOS_DESPESAS.TOTAL_GERAL);
    expect(h).toContain('03/02/2027');
    expect(h).toContain('2 lançamento(s) em conta desconhecida');
    const p = planilhaDespesas(t.relatorio!, undefined);
    expect(p.colunas.map((c) => c.titulo)).toEqual(['Conta', 'Descrição', 'set/2026 a dez/2026', 'Jan/27', 'Fev/27', 'Total']);
    expect(p.linhas.at(-1)).toEqual(['', TEXTOS_DESPESAS.TOTAL_GERAL, '100.00', '50.00', '0.00', '150.00']);
    expect(p.linhas[4]![1]).toBe('        Salários');
  });
});
