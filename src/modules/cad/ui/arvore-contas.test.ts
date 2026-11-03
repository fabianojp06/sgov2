import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aplicarFiltros } from '@/modules/ger';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { ArvoreContas } from './arvore-contas';
import { nosVisiveis, podarInativas, textoVazioContas, type NoContaTela } from '../domain/arvore-tela';
import { FILTROS_CONTAS } from './arvore-contas-logica';

// Consulta do plano de contas (plano do P4, Task 7b, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/modules/cad', async (original) => ({ ...(await original<typeof import('@/modules/cad')>()), consultarArvoreContas: async () => arvore }));
const { default: Pagina } = await import('../../../app/(sistema)/cad/plano-contas/page');
const { escopoDaSessao } = await import('../application/consultar-estrutura');

const no = (classificacao: string, descricao: string, reduzido: string | null, situacao: 'Ativa' | 'Inativa', filhos?: NoContaTela[]): NoContaTela => ({
  id: classificacao,
  linha: { classificacao, reduzido, descricao, nivel: String(classificacao.split('.').length), tipo: filhos ? 'Sintética' : 'Analítica', situacao },
  ...(filhos ? { filhos } : {}),
});
const arvore: NoContaTela[] = [
  no('4', 'DESPESAS', null, 'Ativa', [
    no('4.1', 'DESPESAS CORRENTES', null, 'Ativa', [no('4.1.1.1.001', 'Salários', '900', 'Ativa'), no('4.1.1.1.003', 'Férias', '920', 'Inativa')]),
    no('4.9', 'ANTIGA', null, 'Inativa', [no('4.9.1.1.001', 'Velha', '990', 'Inativa')]),
  ]),
  // Raiz inativa: aparece já na primeira renderização (a grade começa recolhida).
  no('9', 'RAIZ INATIVA', null, 'Inativa', [no('9.1.1.1.001', 'Sob a raiz inativa', '999', 'Inativa')]),
];
const ids = (ns: readonly NoContaTela[]): string[] => ns.flatMap((n) => [n.id, ...ids(n.filhos ?? [])]);

describe('"Mostrar inativas"', () => {
  it('desmarcada, tira as inativas e o que está abaixo delas; marcada, mostra tudo', () => {
    expect(ids(podarInativas(arvore))).toEqual(['4', '4.1', '4.1.1.1.001']);
    expect(ids(nosVisiveis(arvore, false))).toEqual(['4', '4.1', '4.1.1.1.001']);
    expect(ids(nosVisiveis(arvore, true))).toEqual(ids(arvore));
    expect(ids(arvore)).toHaveLength(8);
  });

  it('texto da grade vazia: sem contas ou com todas inativas', () => {
    expect(textoVazioContas([])).toMatch(/^Nenhuma conta cadastrada/);
    expect(textoVazioContas([no('9', 'X', null, 'Inativa')])).toBe('Nenhuma conta ativa. Marque "Mostrar inativas" para ver as inativas.');
  });
});

describe('filtro Tipo', () => {
  it('"Analítica" deixa só as analíticas e os ancestrais delas', () => {
    expect(ids(aplicarFiltros(arvore, FILTROS_CONTAS, { tipo: 'Analítica' }).nos)).toEqual(['4', '4.1', '4.1.1.1.001', '4.1.1.1.003', '4.9', '4.9.1.1.001', '9', '9.1.1.1.001']);
    expect(ids(aplicarFiltros(arvore, FILTROS_CONTAS, { tipo: 'Sintética' }).nos)).toEqual(['4', '4.1', '4.9', '9']);
  });
});

describe('filtro de texto (US-044): classificação, reduzido e descrição', () => {
  it.each([
    ['4.1.1.1.001', ['4', '4.1', '4.1.1.1.001']],
    ['920', ['4', '4.1', '4.1.1.1.003']],
    ['ferias', ['4', '4.1', '4.1.1.1.003']],
  ])('%s', (busca, esperado) => {
    expect(ids(aplicarFiltros(arvore, FILTROS_CONTAS, { busca }).nos)).toEqual(esperado);
  });
});

describe('ArvoreContas (SSR)', () => {
  it('só leitura (C27, RN_PLA_001): sem Novo, Alterar nem Excluir; inativas fora até "Mostrar inativas"', () => {
    const html = renderToString(createElement(ArvoreContas, { nos: arvore, escopoSessao: 'abc' }));
    expect(html).not.toMatch(/>(Novo|Incluir|Alterar|Excluir)</);
    expect(html).toContain('Mostrar inativas');
    expect(html).toContain('DESPESAS');
    expect(html).not.toContain('RAIZ INATIVA');
    expect(html).toContain('Buscar por classificação, reduzido ou descrição');
  });
});

describe('página /cad/plano-contas', () => {
  let contexto: ContextoRequisicao;
  beforeEach(() => {
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
  });
  // "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
  const ctx = (...acoes: string[]): ContextoRequisicao => ({
    usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
    usuarioRotulo: 'u',
    sessaoUid: 'sessao-com-ip-10.0.0.1',
    ip: null,
    permissoes: new Set(acoes.map((a) => `cad.plano_contas:${a}`)),
  });
  const html = async () => renderToString((await Pagina()) as Parameters<typeof renderToString>[0]);

  it('"Importar arquivo" só com executar', async () => {
    contexto = ctx('consultar');
    expect(await html()).not.toContain('Importar arquivo');
    contexto = ctx('consultar', 'executar');
    expect(await html()).toContain('href="/cad/plano-contas/importar"');
  });

  it('o escopo da sessão é o hash (16 caracteres base64url), nunca o sessaoUid cru', async () => {
    contexto = ctx('consultar');
    expect(escopoDaSessao(contexto)).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(escopoDaSessao(contexto)).not.toBe(escopoDaSessao({ sessaoUid: 'outra' }));
    expect(await html()).not.toContain('sessao-com-ip');
  });
});
