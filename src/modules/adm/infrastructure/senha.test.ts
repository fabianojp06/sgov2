import { describe, expect, it } from 'vitest';
import { POLITICA_PADRAO, validarSenha } from '../domain/politica-senha';
import { gerarSenhaTemporaria } from './gerar-senha';
import { conferirSenha, hashSenha } from './senha-argon2';

describe('senha: geração e hash (RNF0004, RN0020)', () => {
  it('200 senhas temporárias válidas e distintas', () => {
    const senhas = Array.from({ length: 200 }, () => gerarSenhaTemporaria(POLITICA_PADRAO));
    expect(new Set(senhas).size).toBe(200);
    for (const s of senhas) {
      expect(s).toHaveLength(16);
      expect(validarSenha(s, POLITICA_PADRAO)).toEqual([]);
    }
  });

  it('hash Argon2id confere só com a mesma senha, diferenciando caixa', async () => {
    const hash = await hashSenha('Senha12345');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await conferirSenha(hash, 'Senha12345')).toBe(true);
    expect(await conferirSenha(hash, 'senha12345')).toBe(false);
  });

  it('hash corrompido não confere e não lança', async () => expect(await conferirSenha('lixo', 'x')).toBe(false));
});
