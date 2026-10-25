import { beforeEach, describe, expect, it } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import { configurarAuditorNegacao, configurarProvedorContexto } from './configuracao';
import { exigirPagina } from './exigir-pagina';
import { limparJanelaNegacoes } from './guarda';
import type { ContextoRequisicao } from './tipos';

const base: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'ana',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(['adm.usuarios:consultar']),
};
let contexto: ContextoRequisicao | null;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  contexto = base;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

// O Next sinaliza redirect e notFound lançando um erro com digest próprio.
const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));

describe('exigirPagina', () => {
  it('sem sessão → redirect para /login', async () => {
    contexto = null;
    expect(await digest(exigirPagina('adm.usuarios', 'consultar'))).toMatch(/^NEXT_REDIRECT;.*;\/login;/);
  });

  it('troca de senha pendente → redirect para /troca-senha', async () => {
    contexto = { ...base, trocaSenhaPendente: true };
    expect(await digest(exigirPagina('adm.usuarios', 'consultar'))).toMatch(/^NEXT_REDIRECT;.*;\/troca-senha;/);
  });

  it('troca pendente na própria página de troca → passa', async () => {
    contexto = { ...base, trocaSenhaPendente: true, permissoes: new Set(['aut.senha:alterar']) };
    await expect(exigirPagina('aut.senha', 'alterar')).resolves.toMatchObject({ usuarioId: base.usuarioId });
  });

  it('sem a permissão → notFound e negação auditada', async () => {
    expect(await digest(exigirPagina('adm.usuarios', 'incluir'))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(negacoes).toHaveLength(1);
    expect(negacoes[0]).toMatchObject({ funcionalidade: 'adm.usuarios', descricao: expect.stringContaining('(incluir)') });
  });

  it('com a permissão → devolve o contexto', async () =>
    expect(await exigirPagina('adm.usuarios', 'consultar')).toBe(base));
});
