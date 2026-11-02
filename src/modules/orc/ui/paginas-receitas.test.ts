import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({ comEscopo: false }));
vi.mock('@/modules/orc', async (original) => {
  const { ErroPermissao } = await import('@/shared/authz');
  const negar = () => {
    if (caso.comEscopo) throw new ErroPermissao('orc.receitas', 'consultar');
  };
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: 'RASCUNHO', rotuloSituacao: 'Rascunho', versao: 0 }],
    listarReceitas: async () => {
      negar();
      return { confirmadas: [], previstas: [], totalConfirmadoMes: [], totalPrevistoMes: [], editavel: true };
    },
    obterReceita: async () => {
      negar();
      return null;
    },
  };
});

const { default: Lista } = await import('../../../app/(sistema)/orc/receitas/page');
const { default: Nova } = await import('../../../app/(sistema)/orc/receitas/novo/page');
const { default: Alterar } = await import('../../../app/(sistema)/orc/receitas/[id]/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.comEscopo = false;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const searchParams = Promise.resolve({});
const params = Promise.resolve({ id: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c' });

describe('páginas de receitas', () => {
  it('Gestor de Diretoria (só orc.orcamento): 404 nas três, com as negações auditadas', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    expect(await digest(Lista({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Nova({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(new Set(negacoes.map((n) => n.funcionalidade))).toEqual(new Set(['orc.receitas']));
  });

  it('com a permissão, mas com escopo (R15): 404 na lista e na alteração', async () => {
    contexto = ctx(['orc.receitas:consultar', 'orc.receitas:alterar']);
    caso.comEscopo = true;
    expect(await digest(Lista({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('Nova receita com escopo (R15): 404', async () => {
    contexto = ctx(['orc.receitas:incluir']);
    caso.comEscopo = true;
    expect(await digest(Nova({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('DIREX (consultar): a lista abre; receita inexistente na alteração dá 404', async () => {
    contexto = ctx(['orc.receitas:consultar', 'orc.receitas:alterar']);
    expect(await digest(Lista({ searchParams }))).toBe('sem erro');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
