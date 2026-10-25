import { describe, expect, it } from 'vitest';
import { POLITICA_PADRAO, validarSenha } from './politica-senha';

describe('validarSenha (RN0039, GAP-AUT-002)', () => {
  it('política padrão provisória: 10 caracteres, letra e dígito', () =>
    expect(POLITICA_PADRAO).toEqual({ minimo: 10, exigeLetra: true, exigeDigito: true }));

  it.each([
    ['curta1', 'A senha deve ter pelo menos 10 caracteres'],
    ['somenteletras', 'A senha deve ter pelo menos um dígito'],
    ['1234567890', 'A senha deve ter pelo menos uma letra'],
  ])('%j é recusada', (senha, mensagem) =>
    expect(validarSenha(senha, POLITICA_PADRAO)).toContainEqual({ campo: 'novaSenha', mensagem }),
  );

  it('senha válida não tem erro', () => expect(validarSenha('Senha12345', POLITICA_PADRAO)).toEqual([]));
  it('usa o campo informado', () =>
    expect(validarSenha('x', POLITICA_PADRAO, 'senha').every((e) => e.campo === 'senha')).toBe(true));
  it('senha acima de 128 caracteres é recusada', () =>
    expect(validarSenha(`a1${'b'.repeat(127)}`, POLITICA_PADRAO)).toContainEqual({
      campo: 'novaSenha',
      mensagem: 'A senha deve ter no máximo 128 caracteres',
    }));
  it('letra acentuada conta como letra', () =>
    expect(validarSenha('ááááááááá1', POLITICA_PADRAO)).toEqual([]));
});
