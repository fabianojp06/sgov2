import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import { configurarAuditorNegacao, configurarProvedorContexto } from './configuracao';
import { exigirPagina } from './exigir-pagina';
import { limparJanelaNegacoes } from './guarda';
import type { ContextoRequisicao } from './tipos';

// Fora do Next, connection() não tem requisição: no teste, só registra a chamada.
const conexao = vi.hoisted(() => ({ chamadas: 0 }));
vi.mock('next/server', () => ({ connection: async () => void conexao.chamadas++ }));

const base: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'ana',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(['adm.usuarios:consultar']),
};
let contexto: ContextoRequisicao | null;
let motivo: 'NOVO_ACESSO' | null;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  contexto = base;
  motivo = null;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto, motivoAusencia: async () => motivo });
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

  it('sem sessão e encerrada por novo acesso → redirect para /login?motivo=novo-acesso (US-028)', async () => {
    contexto = null;
    motivo = 'NOVO_ACESSO';
    expect(await digest(exigirPagina('adm.usuarios', 'consultar'))).toMatch(/^NEXT_REDIRECT;.*;\/login\?motivo=novo-acesso;/);
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

  it('marca a página como dinâmica (connection)', async () => {
    conexao.chamadas = 0;
    await exigirPagina('adm.usuarios', 'consultar');
    expect(conexao.chamadas).toBe(1);
  });
});
