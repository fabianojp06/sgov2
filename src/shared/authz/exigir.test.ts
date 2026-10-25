import { describe, expect, it } from 'vitest';
import { ErroDominio } from '@/shared/kernel';
import { exigir } from './exigir';
import { ErroPermissao, type ContextoRequisicao } from './tipos';

const ctx: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'ana',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(['usuarios:consultar']),
};

describe('exigir', () => {
  it('passa com a permissão "<funcionalidade>:<acao>"', () => {
    expect(() => exigir(ctx, 'usuarios', 'consultar')).not.toThrow();
  });

  it('lança ErroPermissao (um ErroDominio) sem a permissão', () => {
    expect(() => exigir(ctx, 'usuarios', 'excluir')).toThrow(ErroPermissao);
    expect(() => exigir(ctx, 'usuarios', 'excluir')).toThrow(ErroDominio);
    expect(() => exigir(ctx, 'usuarios', 'excluir')).toThrow(
      expect.objectContaining({ codigo: 'PERMISSAO_NEGADA', detalhes: { funcionalidade: 'usuarios', acao: 'excluir' } }),
    );
  });

  it('não confunde funcionalidades com prefixo comum', () => {
    expect(() => exigir({ ...ctx, permissoes: new Set(['usuarios-admin:consultar']) }, 'usuarios', 'consultar')).toThrow(
      ErroPermissao,
    );
  });
});
