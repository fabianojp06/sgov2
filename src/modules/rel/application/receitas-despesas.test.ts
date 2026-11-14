import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONTAS_EXEMPLO, type NoConta } from '@/modules/cad';
import type { ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { TabelaReceitasDespesas, TEXTOS_RECEITAS_DESPESAS } from '../ui/receitas-despesas';
import { MENSAGENS_DESPESAS, type PortaRealizado } from './despesas-tp';
import { COLUNAS_POR_PAGINA_PDF, obterReceitasDespesasTp, planilhasDoFormato, ROTULO_CRONOGRAMA } from './receitas-despesas';
import { montarPrevistoRealizado, saldosAcumulados } from './receitas-despesas-montagem';

vi.mock('server-only', () => ({}));

// Demonstrativo de receitas e despesas sintético do TP (US-096 parte 2; UC05.01): previsto, realizado e saldo.
const l = (conta: string, competencia: string, valor: string) => ({ conta, competencia, valor: Dinheiro.de(valor) });
const REALIZADO = [l('4.1.1.1.001', '2026-10', '100.00'), l('4.1.1.1.001', '2027-01', '50.00')];
const PREVISTO = [l('4.1.1.1.001', '2026-09', '80.00'), l('4.1.1.1.001', '2027-01', '60.00'), l('4.1.1.1.001', '2027-02', '40.00'), l('4.1.1.2.001', '2027-02', '10.00'), l('9.9.9', '2027-01', '5.00')];
const op = (exibirZerados = false) => ({ exibirZerados, anoAtual: 2027 });
const prs = (previsto: string, realizado: string, saldo: string) => ({ previsto, realizado, saldo });

describe('montarPrevistoRealizado', () => {
  it('saldo acumulado: 1ª coluna previsto − realizado (RN0391); depois, + o saldo anterior (RN0388/0392)', () => {
    const d = (xs: string[]) => xs.map((x) => Dinheiro.de(x));
    expect(saldosAcumulados(d(['80', '60', '40']), d(['100', '50', '0'])).map((v) => v.paraString())).toEqual(['-20.00', '-10.00', '30.00']);
  });

  it('colunas "Total AAAA a AAAA" e meses (REQ0246); por conta P/R/S, total geral (REQ0252) e o cronograma (RN0386)', () => {
    const r = montarPrevistoRealizado(CONTAS_EXEMPLO, REALIZADO, PREVISTO, '2026-09', '2027-02', op());
    expect(r.colunas.map((c) => c.rotulo)).toEqual(['Total 2026 a 2026', 'Jan/27', 'Fev/27']);
    expect(r.linhas.find((x) => x.classificacao === '4.1.1.1.001')).toMatchObject({
      valores: [prs('80.00', '100.00', '-20.00'), prs('60.00', '50.00', '-10.00'), prs('40.00', '0.00', '30.00')],
      total: prs('180.00', '150.00', '30.00'),
    });
    expect(r.linhas.find((x) => x.classificacao === '4.1.1.2.001')!.total).toEqual(prs('10.00', '0.00', '10.00'));
    expect(r.totalGeral).toEqual({
      valores: [prs('80.00', '100.00', '-20.00'), prs('60.00', '50.00', '-10.00'), prs('50.00', '0.00', '40.00')],
      total: prs('190.00', '150.00', '40.00'),
    });
    // O cronograma soma todo o previsto, inclusive o de conta fora da árvore (avisado).
    expect(r.cronograma).toEqual({ valores: ['80.00', '65.00', '50.00'], total: '195.00' });
    expect(r.foraDaArvore).toEqual({ previsto: { quantidade: 1, valor: '5.00' }, realizado: { quantidade: 0, valor: '0.00' } });
  });

  it('sintéticas ativas sempre (REQ0249); analítica sem valor só com "exibir zerados" (RN0383); inativa só com valor', () => {
    const r = montarPrevistoRealizado(CONTAS_EXEMPLO, REALIZADO, PREVISTO, '2026-09', '2027-02', op());
    const sinteticas = (nos: readonly NoConta[]): string[] => nos.flatMap((n) => (n.tipo === 'ANALITICA' || !n.ativa ? [] : [n.classificacao, ...sinteticas(n.filhos)]));
    const esperadas = sinteticas(CONTAS_EXEMPLO.filter((n) => n.classificacao === '4'));
    expect(r.linhas.filter((x) => !x.analitica).map((x) => x.classificacao)).toEqual(esperadas);
    expect(r.linhas.filter((x) => x.analitica).map((x) => x.classificacao)).toEqual(['4.1.1.1.001', '4.1.1.2.001']);
    expect(montarPrevistoRealizado(CONTAS_EXEMPLO, REALIZADO, PREVISTO, '2026-09', '2027-02', op(true)).linhas.map((x) => x.classificacao)).toContain('4.1.1.1.003');
    const inativar = (nos: readonly NoConta[]): NoConta[] => nos.map((n) => ({ ...n, ativa: n.classificacao === '4.1.1.2' ? false : n.ativa, filhos: inativar(n.filhos) }));
    const i = montarPrevistoRealizado(inativar(CONTAS_EXEMPLO), REALIZADO, PREVISTO, '2026-09', '2027-02', op(true));
    expect(i.linhas.find((x) => x.classificacao === '4.1.1.2.001')).toMatchObject({ inativa: true, total: prs('10.00', '0.00', '10.00') });
    expect(i.totalGeral.total).toEqual(prs('190.00', '150.00', '40.00'));
  });
});

const perm = (a: string) => ['rel.receitas_despesas_tp', a].join(':');
const ctx = (realizado = true): ContextoRequisicao => ({
  usuarioId: 'u',
  usuarioRotulo: 'gfin',
  sessaoUid: 's',
  ip: null,
  unidadeId: null,
  permissoes: new Set([perm('consultar'), perm('exportar'), ...(realizado ? [['orc.realizado', 'consultar'].join(':')] : [])]),
});
const TP = { numero: 'TP-3', objeto: 'Apoio à gestão', inicio: '2026-09', fim: '2027-02', versaoOficial: 2 };
const pedidos: unknown[] = [];
const dados = { linhas: REALIZADO, ajustes: [], pendencias: { quantidade: 0, valor: Dinheiro.zero() }, atualizadoEm: null };
const porta = (extra: object = { previsto: PREVISTO, versaoPrevisto: 2, previstoSemPessoal: true, pessoalNaoHomologado: false }): PortaRealizado => ({
  tps: async () => [TP],
  realizado: async (_c, f) => (pedidos.push(f), { ...dados, ...extra }),
});
const deps = { agora: () => new Date('2027-02-10T12:00:00Z'), contas: async () => CONTAS_EXEMPLO as NoConta[] };

describe('obterReceitasDespesasTp', () => {
  it('pede o previsto à porta do orc, com a vigência inteira por padrão; os avisos do previsto vêm junto', async () => {
    const t = await obterReceitasDespesasTp(ctx(), { tp: 'TP-3' }, porta(), deps);
    expect(pedidos.at(-1)).toEqual({ tp: 'TP-3', de: '2026-09', ate: '2027-02', previsto: true });
    expect(t.relatorio).toMatchObject({ versaoPrevisto: 2, previstoSemPessoal: true, pessoalNaoHomologado: false, cronograma: { total: '195.00' } });
  });

  it('sem versão oficializada, o previsto sai zerado e avisado; sem o realizado do orc, a mensagem', async () => {
    const t = await obterReceitasDespesasTp(ctx(), { tp: 'TP-3' }, porta({ previsto: [], versaoPrevisto: null }), deps);
    expect(t.relatorio).toMatchObject({ versaoPrevisto: null, cronograma: { total: '0.00' }, totalGeral: { total: prs('0.00', '150.00', '-150.00') } });
    const html = renderToStaticMarkup(createElement(TabelaReceitasDespesas, { relatorio: t.relatorio! }));
    expect(html).toContain(TEXTOS_RECEITAS_DESPESAS.SEM_VERSAO);
    expect(await obterReceitasDespesasTp(ctx(false), { tp: 'TP-3' }, porta(), deps)).toMatchObject({ relatorio: null, erro: MENSAGENS_DESPESAS.SEM_REALIZADO });
  });

  it('tela: cronograma, cabeçalho em dois níveis (Previsto, Realizado e Saldo) e os avisos', async () => {
    const t = await obterReceitasDespesasTp(ctx(), { tp: 'TP-3' }, porta(), deps);
    const html = renderToStaticMarkup(createElement(TabelaReceitasDespesas, { relatorio: t.relatorio! }));
    expect(html).toContain('Cronograma de desembolso');
    expect(html).toMatch(/colSpan="3"/i);
    expect(html.match(/>Saldo</g)).toHaveLength(4);
    expect(html).toContain(TEXTOS_RECEITAS_DESPESAS.VERSAO(2));
    expect(html).toContain(TEXTOS_RECEITAS_DESPESAS.SEM_PESSOAL);
    expect(html).toContain(TEXTOS_RECEITAS_DESPESAS.FORA_PREVISTO(1, Dinheiro.de('5.00').formatar()));
  });

  it('arquivo: uma planilha no XLSX/CSV, com o cronograma no topo; no PDF, um bloco de colunas por página', async () => {
    const tp = { ...TP, inicio: '2026-01', fim: '2027-12' };
    const p2 = { ...porta(), tps: async () => [tp] };
    const t = await obterReceitasDespesasTp(ctx(), { tp: 'TP-3' }, p2, deps);
    const r = t.relatorio!;
    expect(r.colunas).toHaveLength(13);
    const [xlsx] = planilhasDoFormato(r, undefined, 'xlsx');
    expect(xlsx!.colunas).toHaveLength(2 + 14 * 3);
    expect(xlsx!.linhas[0]!.slice(0, 5)).toEqual(['', ROTULO_CRONOGRAMA, '80.00', null, null]);
    const pdf = planilhasDoFormato(r, undefined, 'pdf');
    expect(pdf).toHaveLength(Math.ceil(13 / COLUNAS_POR_PAGINA_PDF));
    expect(pdf.map((p) => p.colunas.length)).toEqual([14, 14, 14, 2 + 2 * 3]);
    expect(pdf.at(-1)!.colunas.at(-1)!.titulo).toBe('Total Saldo');
    for (const p of pdf) expect(p.linhas.every((x) => x.length === p.colunas.length)).toBe(true);
  });
});
