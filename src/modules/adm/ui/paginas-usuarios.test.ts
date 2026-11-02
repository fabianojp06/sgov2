import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Fora do Next, connection() não tem requisição.
vi.mock('next/server', () => ({ connection: async () => undefined }));
// A listagem passa da guarda no segundo caso: sem banco no teste de unidade.
vi.mock('@/modules/adm', async (original) => ({ ...(await original<typeof import('@/modules/adm')>()), listarUsuarios: async () => [] }));

const { default: Lista } = await import('../../../app/(sistema)/adm/usuarios/page');
const { default: Novo } = await import('../../../app/(sistema)/adm/usuarios/novo/page');
const { default: Alterar } = await import('../../../app/(sistema)/adm/usuarios/[id]/page');

const ID = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: ID, usuarioRotulo: 'orc', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const params = Promise.resolve({ id: ID });
const searchParams = Promise.resolve({});

// Guarda das páginas (exigirPagina): sem a permissão, 404 com a negação auditada, antes de ler dados.
describe('páginas de usuário sem permissão', () => {
  it('orçamentista em /adm/usuarios, /novo e /[id]: 404', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Lista({ searchParams }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Novo())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(3);
    expect(negacoes.every((n) => n.funcionalidade === 'adm.usuarios')).toBe(true);
  });

  it('só consultar: a listagem passa da guarda, cadastro e alteração dão 404', async () => {
    contexto = ctx(['adm.usuarios:consultar']);
    expect(await digest(Lista({ searchParams }))).toBe('sem erro');
    expect(negacoes).toEqual([]);
    expect(await digest(Novo())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
