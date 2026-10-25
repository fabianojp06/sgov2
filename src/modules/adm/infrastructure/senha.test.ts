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

  it('política com mínimo acima de 128 não trava a geração: limita a 128', () => {
    const s = gerarSenhaTemporaria({ minimo: 500, exigeLetra: true, exigeDigito: true });
    expect(s).toHaveLength(128);
  });

  it('senha em NFD confere com o hash da mesma senha em NFC', async () => {
    const nfc = 'Ação2026abc'.normalize('NFC');
    const hash = await hashSenha(nfc);
    expect(await conferirSenha(hash, nfc.normalize('NFD'))).toBe(true);
  });

  it('hash corrompido não confere e não lança', async () => expect(await conferirSenha('lixo', 'x')).toBe(false));
});

describe('conferirSenha com hash ilegível', () => {
  it('registra no log, sem a senha', async () => {
    const { vi } = await import('vitest');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await conferirSenha('lixo', 'SegredoX1')).toBe(false);
    expect(log).toHaveBeenCalledWith('[SENHA_HASH_INVALIDO]', expect.not.objectContaining({ senha: expect.anything() }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('SegredoX1');
    log.mockRestore();
  });
});
