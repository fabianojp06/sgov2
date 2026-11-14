import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CONTAS_EXEMPLO, type NoConta } from '@/modules/cad';
import type { ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { TabelaViagens } from '../ui/viagens-tp';
import { MENSAGENS_DESPESAS, type PortaRealizado } from './despesas-tp';
import { podarPorTexto, subarvores } from './despesas-tp-montagem';
import { MENSAGENS_VIAGENS, obterViagensTp, planilhaViagens } from './viagens-tp';

vi.mock('server-only', () => ({}));

// Demonstrativo analítico de despesas com viagens do TP (US-097 parte 1; UC05.03).
const perm = (f: string, a: string) => [f, a].join(':');
const ctx = (acoes = ['consultar', 'exportar'], realizado = true): ContextoRequisicao => ({
  usuarioId: 'u',
  usuarioRotulo: 'gfin',
  sessaoUid: 's',
  ip: null,
  unidadeId: null,
  permissoes: new Set([...acoes.map((a) => perm('rel.viagens_tp', a)), ...(realizado ? [perm('orc.realizado', 'consultar')] : [])]),
});
const no = (classificacao: string, descricao: string, filhos: NoConta[] = [], ativa = true): NoConta => {
  const nivel = classificacao.split('.').length as NoConta['nivel'];
  return { classificacao, codigoReduzido: nivel === 5 ? classificacao : null, descricao, nivel, tipo: nivel === 5 ? 'ANALITICA' : 'SINTETICA', ativa, filhos };
};
// As despesas do exemplo (pessoal) e, ao lado, a sintética de viagens com duas subcategorias e a de diárias.
const ARVORE: NoConta[] = [
  {
    ...CONTAS_EXEMPLO[0]!,
    filhos: [
      {
        ...CONTAS_EXEMPLO[0]!.filhos[0]!,
        filhos: [
          ...CONTAS_EXEMPLO[0]!.filhos[0]!.filhos,
          no('4.1.2', 'DESPESA DE VIAGEM', [
            no('4.1.2.1', 'PASSAGEM AÉREA', [no('4.1.2.1.001', 'Passagem aérea - Projetos'), no('4.1.2.1.002', 'Passagem aérea - Treinamentos')]),
            no('4.1.2.2', 'DESPESA DE TRANSPORTE', [no('4.1.2.2.001', 'Táxi'), no('4.1.2.2.002', 'Aluguel de carro')]),
          ]),
          no('4.1.3', 'DIÁRIAS', [no('4.1.3.1', 'DIÁRIAS', [no('4.1.3.1.001', 'Diária')])]),
        ],
      },
    ],
  },
];
const TP = { numero: 'TP-3', objeto: 'Apoio à gestão', inicio: '2026-09', fim: '2028-12', versaoOficial: 2 };
const porta: PortaRealizado = {
  tps: async () => [TP],
  realizado: async () => ({
    linhas: [
      { conta: '4.1.1.1.001', competencia: '2026-10', valor: Dinheiro.de('9000.00') },
      { conta: '4.1.2.1.001', competencia: '2026-10', valor: Dinheiro.de('1200.00') },
      { conta: '4.1.2.2.001', competencia: '2027-01', valor: Dinheiro.de('80.50') },
      { conta: '4.1.3.1.001', competencia: '2027-01', valor: Dinheiro.de('300.00') },
    ],
    ajustes: [],
    pendencias: { quantidade: 0, valor: Dinheiro.zero() },
    atualizadoEm: new Date('2027-02-03T15:00:00Z'),
  }),
};
const deps = (sinteticas: readonly string[] = ['4.1.2', '4.1.3']) => ({
  agora: () => new Date('2027-02-10T12:00:00Z'),
  contas: async () => ARVORE,
  sinteticas: async () => sinteticas,
});

describe('subarvores e podarPorTexto', () => {
  it('acha as sintéticas em qualquer nível, sem repetir a que está abaixo de outra pedida', () => {
    expect(subarvores(ARVORE, ['4.1.3', '4.1.2', '4.1.2.1']).map((n) => n.classificacao)).toEqual(['4.1.2', '4.1.3']);
    expect(subarvores(ARVORE, ['9.9'])).toEqual([]);
  });

  it('fica a conta que casa (classificação ou descrição, sem acento) com tudo abaixo e as sintéticas acima', () => {
    const [v] = subarvores(podarPorTexto(ARVORE, 'TAXI'), ['4.1.2']);
    expect(v!.filhos.map((f) => f.classificacao)).toEqual(['4.1.2.2']);
    expect(v!.filhos[0]!.filhos.map((f) => f.classificacao)).toEqual(['4.1.2.2.001']);
    const [p] = subarvores(podarPorTexto(ARVORE, '4.1.2.1'), ['4.1.2']);
    expect(p!.filhos.map((f) => f.classificacao)).toEqual(['4.1.2.1']);
    expect(p!.filhos[0]!.filhos).toHaveLength(2);
    expect(podarPorTexto(ARVORE, '  ')).toEqual(ARVORE);
    // Prefixo de classificação só pelo nível: "4.1.1" não pega "4.1.10".
    const vizinhas = [no('4.1', 'X', [no('4.1.1', 'A', [no('4.1.1.1', 'B', [no('4.1.1.1.001', 'b')])]), no('4.1.10', 'C', [no('4.1.10.1', 'D', [no('4.1.10.1.001', 'd')])])])];
    expect(podarPorTexto(vizinhas, '4.1.1')[0]!.filhos.map((f) => f.classificacao)).toEqual(['4.1.1']);
  });
});

describe('obterViagensTp', () => {
  it('só as contas de viagens e diárias marcadas, com as subcategorias somando e o total geral (REQ0279/0285/0287)', async () => {
    const t = await obterViagensTp(ctx(), { tp: 'TP-3' }, porta, deps());
    const r = t.relatorio!;
    expect(r.linhas.map((l) => [l.classificacao, l.total])).toEqual([
      ['4.1.2', '1280.50'],
      ['4.1.2.1', '1200.00'],
      ['4.1.2.1.001', '1200.00'],
      ['4.1.2.2', '80.50'],
      ['4.1.2.2.001', '80.50'],
      ['4.1.3', '300.00'],
      ['4.1.3.1', '300.00'],
      ['4.1.3.1.001', '300.00'],
    ]);
    // O salário (9.000) não entra: o demonstrativo é só de viagens.
    expect(r.totalGeral.total).toBe('1580.50');
    expect(r.linhas[0]).toMatchObject({ nivel: 0, analitica: false });
    expect(r.linhas[2]).toMatchObject({ nivel: 2, analitica: true });
  });

  it('com zerados, todas as contas de viagens (REQ0283); o filtro de conta ou descrição soma só o que ficou (REQ0281/0282)', async () => {
    const z = await obterViagensTp(ctx(), { tp: 'TP-3', zerados: 'sim' }, porta, deps());
    expect(z.relatorio!.linhas).toHaveLength(10);
    expect(z.relatorio!.linhas.find((l) => l.classificacao === '4.1.2.2.002')!.total).toBe('0.00');
    const f = await obterViagensTp(ctx(), { tp: 'TP-3', texto: 'passagem' }, porta, deps());
    expect(f.filtros.texto).toBe('passagem');
    expect(f.relatorio!.linhas.map((l) => l.classificacao)).toEqual(['4.1.2', '4.1.2.1', '4.1.2.1.001']);
    expect(f.relatorio!.totalGeral.total).toBe('1200.00');
  });

  it('sem contas marcadas, a mensagem para a GFIN; sem o realizado do orc, a mensagem dele; sem a permissão, recusa', async () => {
    expect(await obterViagensTp(ctx(), { tp: 'TP-3' }, porta, deps([]))).toMatchObject({ relatorio: null, erro: MENSAGENS_VIAGENS.SEM_CONTAS });
    expect(await obterViagensTp(ctx(undefined, false), { tp: 'TP-3' }, porta, deps())).toMatchObject({ erro: MENSAGENS_DESPESAS.SEM_REALIZADO });
    await expect(obterViagensTp(ctx([]), {}, porta, deps())).rejects.toThrow();
  });

  it('a tabela e a planilha: título do TP, subcategoria em negrito e o total geral de viagens e diárias', async () => {
    const r = (await obterViagensTp(ctx(), { tp: 'TP-3' }, porta, deps())).relatorio!;
    const h = renderToStaticMarkup(createElement(TabelaViagens, { relatorio: r }));
    expect(h).toContain('TP-3 – Apoio à gestão');
    expect(h).toContain('<strong>DESPESA DE TRANSPORTE</strong>');
    expect(h).toContain(MENSAGENS_VIAGENS.TOTAL_GERAL);
    const vazio = { ...r, linhas: [] };
    expect(renderToStaticMarkup(createElement(TabelaViagens, { relatorio: vazio, filtrado: true }))).toContain('casa com o filtro');
    const p = planilhaViagens(r, undefined);
    expect(p.linhas).toHaveLength(r.linhas.length + 1);
    expect(p.linhas.at(-1)).toEqual(['', MENSAGENS_VIAGENS.TOTAL_GERAL, ...r.totalGeral.valores, '1580.50']);
  });
});
