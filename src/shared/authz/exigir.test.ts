import { describe, expect, it } from 'vitest';
import { ErroDominio } from '@/shared/kernel';
import { exigir } from './exigir';
import { ErroPermissao, type ContextoRequisicao } from './tipos';

const ctx: ContextoRequisicao = {
  usuarioId: null,
  usuarioRotulo: 'ana',
  sessaoUid: null,
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
