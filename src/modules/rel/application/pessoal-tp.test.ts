import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { TabelaDistribuicao, TabelaSalarios, TEXTOS_PESSOAL } from '../ui/pessoal-tp';
import { MENSAGENS_PESSOAL, obterDistribuicaoTp, obterSalariosTp, planilhaDistribuicao, planilhaSalarios, type PortaPessoal } from './pessoal-tp';
import type { EmpregadoDaVersao } from './pessoal-tp-montagem';

vi.mock('server-only', () => ({}));

// Relatórios de pessoal do TP (US-098; UC05.05 e UC05.06), com a porta de pessoal do orc falsa.
const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u', usuarioRotulo: 'grh', sessaoUid: 's', ip: null, unidadeId: null, permissoes: new Set(permissoes) });
const grh = () => ctx(['rel.salarios_tp:consultar', 'rel.distribuicao_pessoal_tp:consultar', 'orc.realizado:consultar']);
const TP = { numero: 'TP-3', objeto: 'Apoio à gestão', inicio: '2026-09', fim: '2028-12', versaoOficial: 2 };
const e = (ordem: number, x: Partial<EmpregadoDaVersao>): EmpregadoDaVersao => ({
  ordem,
  nome: `Pessoa ${ordem}`,
  categoria: 'EMPREGADO',
  cargo: 'Analista',
  vinculoFuncional: 'Gerência do Programa',
  inicio: '2026-09',
  fim: '2028-12',
  metaNumero: '1',
  metaNome: 'Tarifação',
  custoMensal: Dinheiro.de('5000.00'),
  ...x,
});
const EMPREGADOS = [
  e(2, { metaNumero: '2', metaNome: 'Cobrança', cargo: 'Assistente', vinculoFuncional: 'Cobrança' }),
  e(1, {}),
  e(3, { nome: null, categoria: 'ESTAGIARIO', vinculoFuncional: null, custoMensal: Dinheiro.de('1500.50') }),
  e(4, { inicio: '2026-09', fim: '2026-12' }),
];
const porta = (veCusto = true, porMeta = true, homologado = true): PortaPessoal => ({
  tps: async () => [TP, { ...TP, numero: 'TP-R', versaoOficial: null }],
  pessoal: async (_c, f) =>
    f.tp === 'TP-SEM' ? { versao: null, porMeta, veCusto, homologado, empregados: [] } : { versao: 2, porMeta, veCusto, homologado, empregados: veCusto ? EMPREGADOS : EMPREGADOS.map((x) => ({ ...x, custoMensal: null })) },
});

describe('relatórios de pessoal do TP', () => {
  it('salários: em ordem de meta, numerados, com o total de empregados e dos salários; o período corta quem saiu', async () => {
    const t = await obterSalariosTp(grh(), { tp: 'TP-3', de: '2027-01' }, porta());
    const r = t.relatorio!;
    expect(r.linhas.map((l) => [l.seq, l.nome, l.meta])).toEqual([
      [1, 'Pessoa 1', '1 – Tarifação'],
      [2, 'A CONTRATAR', '1 – Tarifação'],
      [3, 'Pessoa 2', '2 – Cobrança'],
    ]);
    expect(r.totalCustos).toBe('11500.50');
    expect(t.filtros).toMatchObject({ de: '2027-01', ate: '2028-12' });
  });

  it('filtros combináveis: cargo, meta e categoria (REQ0327/0329)', async () => {
    expect((await obterSalariosTp(grh(), { tp: 'TP-3', cargo: 'assist' }, porta())).relatorio!.linhas.map((l) => l.nome)).toEqual(['Pessoa 2']);
    expect((await obterSalariosTp(grh(), { tp: 'TP-3', meta: 'tarifa', categoria: 'ESTAGIARIO' }, porta())).relatorio!.linhas.map((l) => l.nome)).toEqual(['A CONTRATAR']);
  });

  it('sem ver o custo, sem custo na tela nem no arquivo; TP consolidado, sem meta (RN0245); lote não homologado, o aviso', async () => {
    const r = (await obterSalariosTp(grh(), { tp: 'TP-3' }, porta(false, false, false))).relatorio!;
    expect(r.totalCustos).toBeNull();
    expect(r.linhas[0]!.meta).toBeNull();
    const h = renderToStaticMarkup(createElement(TabelaSalarios, { relatorio: r }));
    expect(h).toContain(TEXTOS_PESSOAL.SEM_CUSTO);
    expect(h).toContain(TEXTOS_PESSOAL.NAO_HOMOLOGADO);
    expect(h).not.toContain('Custo mensal previsto');
    expect(h).not.toContain('>Meta<');
    expect(planilhaSalarios(r, undefined).colunas.map((c) => c.titulo)).toEqual(['Seq', 'Nome', 'Cargo', 'Categoria', 'Início', 'Fim']);
  });

  it('distribuição: agrupada por setor (RN0442), "Sem setor" por último, com o total (REQ0338)', async () => {
    const r = (await obterDistribuicaoTp(grh(), { tp: 'TP-3' }, porta())).relatorio!;
    expect(r.grupos.map((g) => [g.setor, g.linhas.length])).toEqual([
      ['Cobrança', 1],
      ['Gerência do Programa', 2],
      ['Sem setor', 1],
    ]);
    const h = renderToStaticMarkup(createElement(TabelaDistribuicao, { relatorio: r }));
    expect(h).toContain('Gerência do Programa: 2 empregado(s)');
    expect(h).not.toContain(TEXTOS_PESSOAL.NAO_HOMOLOGADO);
    expect(h).toContain(TEXTOS_PESSOAL.TOTAL(4));
    expect(h).toContain(TEXTOS_PESSOAL.ORIGEM(2));
    expect(planilhaDistribuicao(r, undefined).linhas.at(-1)).toEqual(['', 'Total de empregados: 4', '', '', '']);
  });

  it('sem o acesso do orc, a mensagem; sem a permissão, recusa; TP sem versão oficial ou fora da vigência, recusa', async () => {
    expect(await obterSalariosTp(ctx(['rel.salarios_tp:consultar']), { tp: 'TP-3' }, porta())).toMatchObject({ relatorio: null, erro: MENSAGENS_PESSOAL.SEM_ACESSO });
    await expect(obterDistribuicaoTp(ctx(['orc.realizado:consultar']), {}, porta())).rejects.toThrow();
    const semVersao = { ...porta(), tps: async () => [{ ...TP, numero: 'TP-SEM' }] };
    expect((await obterSalariosTp(grh(), { tp: 'TP-SEM' }, semVersao)).erro).toBe(MENSAGENS_PESSOAL.TP_INEXISTENTE);
    expect((await obterSalariosTp(grh(), { tp: 'TP-R' }, porta())).erro).toBe(MENSAGENS_PESSOAL.TP_INEXISTENTE);
    expect((await obterSalariosTp(grh(), { tp: 'TP-3', de: '2026-01' }, porta())).erro).toBe(MENSAGENS_PESSOAL.FORA_DA_VIGENCIA);
    expect((await obterSalariosTp(grh(), { tp: 'TP-3', categoria: 'X' }, porta())).erro).toBe(MENSAGENS_PESSOAL.FILTRO_INVALIDO);
  });
});
