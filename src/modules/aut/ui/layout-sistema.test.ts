import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { MENSAGENS_CARREGAMENTO } from './erro-carregamento';

// O layout real, com a guarda e o carregamento falsos: o index do aut levaria o Prisma.
vi.mock('@/shared/authz', () => ({ exigirPagina: vi.fn() }));
vi.mock('@/modules/aut', async () => ({
  carregarTelaPrincipal: vi.fn(),
  trocarUnidade: vi.fn(),
  ErroCarregamento: (await import('./erro-carregamento')).ErroCarregamento,
  TelaPrincipal: (await import('./tela-principal')).TelaPrincipal,
}));

const { exigirPagina } = await import('@/shared/authz');
const { carregarTelaPrincipal } = await import('@/modules/aut');
const { notFound } = await import('next/navigation');
const { default: LayoutSistema } = await import('../../../app/(sistema)/layout');

const ctx = { usuarioId: 'u', usuarioRotulo: 'ana', sessaoUid: 's', ip: null, permissoes: new Set<string>() } as unknown as ContextoRequisicao;
const render = async () => renderToString((await LayoutSistema({ children: createElement('p', null, 'página') })) as ReactElement);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('layout de (sistema) (UC01.03 E1, E2)', () => {
  it('falha ao carregar as permissões → E2', async () => {
    vi.mocked(exigirPagina).mockRejectedValue(new Error('banco'));
    const html = await render();
    expect(html).toContain(MENSAGENS_CARREGAMENTO.permissoes);
    expect(carregarTelaPrincipal).not.toHaveBeenCalled();
  });

  it('falha ao carregar o catálogo → E1', async () => {
    vi.mocked(exigirPagina).mockResolvedValue(ctx);
    vi.mocked(carregarTelaPrincipal).mockRejectedValue(new Error('banco'));
    expect(await render()).toContain(MENSAGENS_CARREGAMENTO.modulos);
  });

  it('redirect/notFound da guarda não vira E2', async () => {
    vi.mocked(exigirPagina).mockImplementation(() => notFound());
    await expect(render()).rejects.toThrow();
  });

  it('com tudo carregado, a tela principal com a página dentro', async () => {
    vi.mocked(exigirPagina).mockResolvedValue(ctx);
    vi.mocked(carregarTelaPrincipal).mockResolvedValue({
      menu: [],
      unidades: [],
      unidadeAtiva: null,
      usuario: { nome: 'Ana', acessoEm: '2026-11-11T12:00:00.000Z' },
    });
    const html = await render();
    expect(html).toContain('página');
    expect(html).toContain('Ana');
  });
});
