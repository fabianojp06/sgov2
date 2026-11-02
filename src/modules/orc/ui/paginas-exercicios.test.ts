import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Fora do Next, connection() não tem requisição; sem banco no teste de unidade.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const sugestao = vi.hoisted(() => ({ comEscopo: false }));
vi.mock('@/modules/orc', async (original) => {
  const { ErroPermissao } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [],
    sugerirAno: async () => {
      if (sugestao.comEscopo) throw new ErroPermissao('orc.exercicios', 'incluir');
      return 2028;
    },
  };
});

const { default: Lista } = await import('../../../app/(sistema)/orc/exercicios/page');
const { default: Novo } = await import('../../../app/(sistema)/orc/exercicios/novo/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  sugestao.comEscopo = false;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const searchParams = Promise.resolve({});

describe('páginas de exercício', () => {
  it('orçamentista: 404 nas duas, com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Lista({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Novo())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['orc.exercicios', 'orc.exercicios']);
  });

  it('só consultar: a lista abre, o Novo exercício dá 404', async () => {
    contexto = ctx(['orc.exercicios:consultar', 'orc.orcamento:consultar']);
    expect(await digest(Lista({ searchParams }))).toBe('sem erro');
    expect(await digest(Novo())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('Novo exercício com CC de escopo (R15): 404', async () => {
    contexto = ctx(['orc.exercicios:consultar', 'orc.exercicios:incluir']);
    sugestao.comEscopo = true;
    expect(await digest(Novo())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
