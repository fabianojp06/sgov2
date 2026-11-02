import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({ comEscopo: false }));
vi.mock('@/modules/orc', async (original) => {
  const { ErroPermissao } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: 'EM_APROVACAO', rotuloSituacao: 'Em Aprovação', versao: 2 }],
    listarTramites: async () => {
      if (caso.comEscopo) throw new ErroPermissao('orc.aprovacao', 'consultar');
      return [];
    },
  };
});
const { default: Pagina } = await import('../../../app/(sistema)/orc/aprovacao/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: string[];
beforeEach(() => {
  caso.comEscopo = false;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e.funcionalidade);
  });
});
const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const searchParams = Promise.resolve({});

describe('página de envio e aprovação', () => {
  it('Gestor de Diretoria (sem orc.aprovacao): 404 auditado', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    expect(await digest(Pagina({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toEqual(['orc.aprovacao']);
  });

  it('com a permissão mas com escopo: 404 auditado; DIREX: abre', async () => {
    contexto = ctx(['orc.aprovacao:consultar', 'orc.aprovacao:aprovar']);
    caso.comEscopo = true;
    expect(await digest(Pagina({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toContain('orc.aprovacao');
    caso.comEscopo = false;
    expect(await digest(Pagina({ searchParams }))).toBe('sem erro');
  });
});
