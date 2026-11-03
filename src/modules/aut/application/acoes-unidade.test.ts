import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./tela-principal', () => ({ validarTrocaUnidade: vi.fn() }));

const { revalidatePath } = await import('next/cache');
const { validarTrocaUnidade } = await import('./tela-principal');
const { trocarUnidade } = await import('./acoes-unidade');

const UNIDADE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ctx: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'ana',
  sessaoUid: 's1',
  ip: '10.0.0.1',
  permissoes: new Set(['aut.unidade:alterar']),
};
let negacoes: EventoAuditoria[];

beforeEach(() => {
  vi.clearAllMocks();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => ctx });
  configurarAuditorNegacao(async (evento) => {
    negacoes.push(evento);
  });
});

// Troca de TP (§6.7) pela ação inteira: guarda, auditoria da negação, cookie e revalidação.
describe('trocarUnidade', () => {
  it('unidade fora da lista → 403, cookie intocado e negação auditada', async () => {
    vi.mocked(validarTrocaUnidade).mockRejectedValue(new ErroPermissao('aut.unidade', 'alterar'));
    expect(await trocarUnidade({ unidadeId: UNIDADE })).toMatchObject({ ok: false, status: 403 });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(negacoes).toHaveLength(1);
    expect(negacoes[0]).toMatchObject({ funcionalidade: 'aut.unidade' });
  });

  it('unidade da lista → cookie HttpOnly, Lax, Path=/ e o layout revalidado', async () => {
    vi.mocked(validarTrocaUnidade).mockResolvedValue();
    expect(await trocarUnidade({ unidadeId: UNIDADE })).toEqual({ ok: true, valor: undefined });
    expect(cookieSet).toHaveBeenCalledWith('sgo_unidade', UNIDADE, expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }));
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(negacoes).toEqual([]);
  });

  it('unidadeId que não é uuid → erro de campo, sem consultar o banco', async () => {
    expect(await trocarUnidade({ unidadeId: 'x' })).toMatchObject({ ok: false, erros: [{ campo: 'unidadeId' }] });
    expect(validarTrocaUnidade).not.toHaveBeenCalled();
  });
});
