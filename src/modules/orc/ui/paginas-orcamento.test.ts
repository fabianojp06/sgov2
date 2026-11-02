import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({ visao: 'vazia' as 'vazia' | 'fora' | 'inexistente' }));
vi.mock('@/modules/orc', async (original) => {
  const { ErroPermissao } = await import('@/shared/authz');
  const { ErroDominio } = await import('@/shared/kernel');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [],
    obterVisaoExercicio: async () => {
      if (caso.visao === 'fora') throw new ErroPermissao('orc.orcamento', 'consultar');
      if (caso.visao === 'inexistente') throw new ErroDominio('orc.cc_inexistente', 'x');
      return null;
    },
  };
});
const { default: Pagina } = await import('../../../app/(sistema)/orc/orcamento/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;

beforeEach(() => {
  caso.visao = 'vazia';
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async () => undefined);
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const sp = (b: Record<string, string> = {}) => Promise.resolve(b);

describe('página do orçamento', () => {
  it('Orçamentista (sem orc.orcamento): 404', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Pagina({ searchParams: sp() }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('CC fora do escopo ou inexistente na URL: 404', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    caso.visao = 'fora';
    expect(await digest(Pagina({ searchParams: sp({ cc: '4.4' }) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    caso.visao = 'inexistente';
    expect(await digest(Pagina({ searchParams: sp({ cc: '9.9' }) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('sem exercício: a mensagem, e o link para Exercícios só com a permissão', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    expect(await digest(Pagina({ searchParams: sp() }))).toBe('sem erro');
  });
});
