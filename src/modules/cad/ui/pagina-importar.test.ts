import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Fora do Next, connection() não tem requisição.
vi.mock('next/server', () => ({ connection: async () => undefined }));

const { default: Importar } = await import('../../../app/(sistema)/cad/plano-contas/importar/page');

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const permissao = (acao: string) => `cad.plano_contas:${acao}`;
const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'orc',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(permissoes),
});
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

// Página da importação (plano do P4, Task 7a): exigirPagina('cad.plano_contas', 'executar').
describe('/cad/plano-contas/importar', () => {
  it('só com consultar (orçamentista): 404 com a negação auditada', async () => {
    contexto = ctx([permissao('consultar')]);
    expect(await digest(Importar())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.plano_contas' })]);
  });

  it('com executar (GFIN): renderiza', async () => {
    contexto = ctx([permissao('consultar'), permissao('executar')]);
    expect(await digest(Importar())).toBe('sem erro');
    expect(negacoes).toEqual([]);
  });
});
