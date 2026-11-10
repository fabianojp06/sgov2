import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Guarda e dados das páginas das alçadas (US-042), sem banco: os casos de uso vêm do mock.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const dados = vi.hoisted(() => ({ alcada: null as unknown, usuarios: [] as { id: string; nome: string }[] }));
vi.mock('@/modules/adm', async (original) => ({
  ...(await original<typeof import('@/modules/adm')>()),
  listarAlcadas: async () => [],
  obterAlcada: async () => dados.alcada,
  listarAprovadoresPossiveis: async () => dados.usuarios,
}));

const { default: Lista } = await import('../../../app/(sistema)/adm/alcadas/page');
const { default: Nova } = await import('../../../app/(sistema)/adm/alcadas/novo/page');
const { default: Alterar } = await import('../../../app/(sistema)/adm/alcadas/[id]/page');

const ID = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: ID, usuarioRotulo: 'adm', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const TODAS = ['adm.alcadas:consultar', 'adm.alcadas:incluir', 'adm.alcadas:alterar', 'adm.alcadas:excluir'];

beforeEach(() => {
  negacoes = [];
  dados.alcada = null;
  dados.usuarios = [{ id: 'u2', nome: 'Bruno Lima' }];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const params = Promise.resolve({ id: ID });
const alcada = (ativa: boolean, titularAtivo = true) => ({
  id: ID,
  fluxo: 'WA01',
  rotuloFluxo: 'Oficialização de proposta',
  titular: { id: 'u1', nome: 'Ana Maria', ativo: titularAtivo },
  substituto: { id: 'u2', nome: 'Bruno Lima', ativo: true },
  ativa,
  inativadaEm: ativa ? null : new Date(),
  versao: 1,
});

describe('páginas das alçadas', () => {
  it('sem permissão: lista, nova e alteração dão 404 com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Lista({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Nova())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['adm.alcadas', 'adm.alcadas', 'adm.alcadas']);
  });

  it('alteração: id sem alçada ou alçada inativa → 404', async () => {
    contexto = ctx(TODAS);
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    dados.alcada = alcada(false);
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('titular atual inativo continua selecionado e identificado (não troca em silêncio)', async () => {
    contexto = ctx(TODAS);
    dados.alcada = alcada(true, false);
    const h = renderToString((await Alterar({ params })) as Parameters<typeof renderToString>[0]);
    expect(h).toMatch(/<option value="u1" selected="">Ana Maria \(inativo\)<\/option>/);
  });
});
