import { describe, expect, it } from 'vitest';
import { ConflitoConcorrencia, exigirUmaLinha, MENSAGEM_CONFLITO } from './concorrencia';
import { ErroDominio } from './erros';

describe('concorrência otimista (US-011)', () => {
  it('a mensagem é a única do projeto para versão desatualizada', () => {
    expect(MENSAGEM_CONFLITO).toBe('Este registro foi alterado por outro usuário. Recarregue a tela.');
  });

  it('ConflitoConcorrencia é ErroDominio: a guarda mostra a mensagem na tela', () => {
    const e = new ConflitoConcorrencia();
    expect(e).toBeInstanceOf(ErroDominio);
    expect(e.codigo).toBe('concorrencia.conflito');
    expect(e.message).toBe(MENSAGEM_CONFLITO);
    expect(e.name).toBe('ConflitoConcorrencia');
  });

  it('exigirUmaLinha: zero linhas (versão velha ou registro sumido) é conflito', () => {
    expect(() => exigirUmaLinha({ count: 0 })).toThrow(ConflitoConcorrencia);
    expect(() => exigirUmaLinha({ count: 2 })).toThrow(ConflitoConcorrencia);
    expect(() => exigirUmaLinha({ count: 1 })).not.toThrow();
  });
});
