import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONTAS_CAPEX_EXEMPLO, CONTAS_EXEMPLO, type NoConta } from '@/modules/cad';
import type { ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { TabelaAquisicoes, TEXTOS_AQUISICOES } from '../ui/aquisicoes-tp';
import { MENSAGENS_AQUISICOES, obterAquisicoesTp, planilhaAquisicoes, type PortaBens } from './aquisicoes-tp';
import { MENSAGENS_DESPESAS, type PortaRealizado } from './despesas-tp';

vi.mock('server-only', () => ({}));

// Demonstrativo de aquisições do TP (US-097 parte 2; UC05.04), com as portas do orc falsas.
const perm = (f: string, a: string) => [f, a].join(':');
const ctx = (acoes = ['consultar', 'exportar'], realizado = true): ContextoRequisicao => ({
  usuarioId: 'u',
  usuarioRotulo: 'gfin',
  sessaoUid: 's',
  ip: null,
  unidadeId: null,
  permissoes: new Set([...acoes.map((a) => perm('rel.aquisicoes_tp', a)), ...(realizado ? [perm('orc.realizado', 'consultar')] : [])]),
});
const TP = { numero: 'TP-3', objeto: 'Apoio à gestão', inicio: '2026-09', fim: '2028-12', versaoOficial: 2 };
const porta: PortaRealizado = {
  tps: async () => [TP],
  realizado: async () => ({
    linhas: [
      { conta: '1.2.3.1.001', competencia: '2027-01', valor: Dinheiro.de('9500.00') },
      { conta: '4.1.1.1.001', competencia: '2027-01', valor: Dinheiro.de('100.00') },
    ],
    ajustes: [],
    pendencias: { quantidade: 0, valor: Dinheiro.zero() },
    atualizadoEm: null,
  }),
};
const bem = (conta: string, descricao: string, data: string, quantidade: number, unit: string) => ({ conta, descricao, data, quantidade, valorUnitario: Dinheiro.de(unit), metaNumero: null });
const bens: PortaBens = async () => ({
  versao: 2,
  itens: [
    bem('1.2.3.1.001', 'Notebook', '2026-10-15', 2, '4500.00'),
    bem('1.2.3.1.001', 'Monitor', '2027-01-20', 3, '1000.50'),
    bem('1.2.3.1.003', 'Mesa', '2027-02-01', 1, '800.00'),
    bem('4.1.1.5.005', 'Papel', '2027-02-01', 10, '20.00'),
    bem('1.2.3.1.003', 'Cadeira', '2029-01-01', 1, '500.00'),
  ],
});
const deps = (sinteticas: readonly string[] = ['1.2.3']) => ({
  agora: () => new Date('2027-02-10T12:00:00Z'),
  contas: async () => [...CONTAS_EXEMPLO, ...CONTAS_CAPEX_EXEMPLO] as NoConta[],
  sinteticas: async () => sinteticas,
  bens,
});

describe('obterAquisicoesTp', () => {
  it('as contas do Imobilizado com os bens no mês da data (qtde × unitário, RN0412/0414), o total e o realizado', async () => {
    const r = (await obterAquisicoesTp(ctx(), { tp: 'TP-3' }, porta, deps())).relatorio!;
    expect(r.contas.map((c) => [c.classificacao, c.total, c.realizado, c.itens.map((i) => i.descricao)])).toEqual([
      ['1.2.3.1.001', '12001.50', '9500.00', ['Notebook', 'Monitor']],
      ['1.2.3.1.003', '800.00', '0.00', ['Mesa']],
    ]);
    const rotulos = r.colunas.map((c) => c.rotulo);
    const nb = r.contas[0]!.itens[0]!;
    expect([rotulos[nb.coluna], nb.valorTotal]).toEqual(['set/2026 a dez/2026', '9000.00']);
    expect(rotulos[r.contas[0]!.itens[1]!.coluna]).toBe('Jan/27');
    expect(r.totalGeral).toMatchObject({ total: '12801.50', realizado: '9500.00' });
    // O papel (despesa) é de conta fora do Imobilizado; a cadeira de 2029 está fora da vigência.
    expect(r.foraDasContas).toEqual({ quantidade: 1, valor: '200.00' });
    expect(r.versao).toBe(2);
  });

  it('filtros combináveis de conta e descrição (REQ0293 a 0295); com descrição, o realizado da conta não entra', async () => {
    const d = (await obterAquisicoesTp(ctx(), { tp: 'TP-3', descricao: 'monitor' }, porta, deps())).relatorio!;
    expect(d.contas.map((c) => [c.classificacao, c.total, c.realizado])).toEqual([['1.2.3.1.001', '3001.50', null]]);
    // O aviso de "fora" respeita o filtro de descrição (o papel não é monitor).
    expect(d.foraDasContas.quantidade).toBe(0);
    expect(renderToStaticMarkup(createElement(TabelaAquisicoes, { relatorio: d }))).toContain(TEXTOS_AQUISICOES.SEM_REALIZADO);
    const c = (await obterAquisicoesTp(ctx(), { tp: 'TP-3', conta: '1.2.3.1.003' }, porta, deps())).relatorio!;
    expect(c.contas.map((x) => x.classificacao)).toEqual(['1.2.3.1.003']);
    expect(c.foraDasContas.quantidade).toBe(0);
    const z = (await obterAquisicoesTp(ctx(), { tp: 'TP-3', zerados: 'sim' }, porta, deps())).relatorio!;
    expect(z.contas.map((x) => x.classificacao)).toEqual(['1.2.3.1.001', '1.2.3.1.002', '1.2.3.1.003']);
  });

  it('sem contas marcadas, a mensagem; sem o realizado do orc, a mensagem dele; sem a permissão, recusa', async () => {
    expect((await obterAquisicoesTp(ctx(), { tp: 'TP-3' }, porta, deps([]))).erro).toBe(MENSAGENS_AQUISICOES.SEM_CONTAS);
    expect((await obterAquisicoesTp(ctx(undefined, false), { tp: 'TP-3' }, porta, deps())).erro).toBe(MENSAGENS_DESPESAS.SEM_REALIZADO);
    await expect(obterAquisicoesTp(ctx([]), {}, porta, deps())).rejects.toThrow();
    const semTp = { ...deps(), bens: (async () => null) as PortaBens };
    expect((await obterAquisicoesTp(ctx(), { tp: 'TP-3' }, porta, semTp)).erro).toBe(MENSAGENS_DESPESAS.TP_INEXISTENTE);
  });

  it('a tabela e a planilha: a conta em negrito, os bens abaixo, o total geral; cada linha com o número de colunas', async () => {
    const r = (await obterAquisicoesTp(ctx(), { tp: 'TP-3' }, porta, deps())).relatorio!;
    const h = renderToStaticMarkup(createElement(TabelaAquisicoes, { relatorio: r }));
    expect(h).toContain('<strong>Equipamentos de informática</strong>');
    expect(h).toContain('15/10/2026');
    expect(h).toContain(TEXTOS_AQUISICOES.VERSAO(2));
    expect(h).toContain('1 bem(ns) do período em conta fora');
    const p = planilhaAquisicoes(r, undefined);
    expect(p.linhas.every((l) => l.length === p.colunas.length)).toBe(true);
    expect(p.linhas).toHaveLength(2 + 3 + 1 + 1);
    expect(p.linhas.at(-2)![1]).toBe(MENSAGENS_AQUISICOES.TOTAL_GERAL);
  });
});
