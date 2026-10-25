import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redirect } from 'next/navigation';
import { aoCancelar, aoFalhar, enviarLogin, MENSAGEM_REDE, validarCampos } from './validar-login';

describe('tela de login: regras do cliente (UC01.01)', () => {
  it.each([
    ['', 'x'],
    ['ana', ''],
    ['   ', 'x'],
    ['ana', '   '],
  ])('campos vazios ou só com espaços → mensagem e sem envio (%j, %j)', (login, senha) =>
    expect(validarCampos(login, senha)).toBe('Login e/ou Senha são obrigatórios'));

  it('campos preenchidos → envia', () => expect(validarCampos('ana', 'x')).toBeNull());

  it('Cancelar limpa os dois campos (A3)', () => expect(aoCancelar()).toEqual({ login: '', senha: '' }));

  it('falha limpa só a senha (E2)', () => expect(aoFalhar({ login: 'ana', senha: 'x' })).toEqual({ login: 'ana', senha: '' }));

  it('erro de rede: mensagem do E8, campos preservados', () =>
    expect(MENSAGEM_REDE).toBe('Não foi possível estabelecer conexão com o servidor. Verifique sua rede e tente novamente.'));

  it('nada no armazenamento do navegador (RNF0002)', () => {
    for (const arquivo of ['validar-login.ts', 'form-login.tsx']) {
      const texto = readFileSync(join(__dirname, arquivo), 'utf8');
      expect(texto).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });
});

describe('enviarLogin', () => {
  const campos = { login: 'ana', senha: 'x' };
  it('redirect do login bem-sucedido passa adiante (não vira erro de rede)', async () => {
    await expect(enviarLogin(async () => redirect('/inicio'), campos)).rejects.toThrow('NEXT_REDIRECT');
  });
  it('falha de rede → mensagem do E8, campos preservados', async () => {
    expect(await enviarLogin(async () => Promise.reject(new TypeError('Failed to fetch')), campos)).toEqual({
      mensagem: MENSAGEM_REDE,
      aviso: null,
      campos,
    });
  });
  it('credenciais recusadas → mensagem, aviso e senha limpa', async () => {
    const r = await enviarLogin(
      async () => ({ ok: false, erros: [{ campo: '_', mensagem: 'Login ou senha inválidos' }, { campo: 'aviso', mensagem: 'A5' }] }),
      campos,
    );
    expect(r).toEqual({ mensagem: 'Login ou senha inválidos', aviso: 'A5', campos: { login: 'ana', senha: '' } });
  });
});
