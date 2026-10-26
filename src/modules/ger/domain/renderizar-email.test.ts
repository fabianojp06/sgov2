import { describe, expect, it } from 'vitest';
import { ErroDominio } from '@/shared/kernel';
import type { MensagemEmail } from './modelos-email';
import { renderizarEmail } from './renderizar-email';

const base: MensagemEmail = {
  modelo: 'usuario.senha_inicial',
  versao: 1,
  destinatario: { email: 'maria@ex.org', nome: 'Maria' },
  dados: { nome: 'Maria', login: 'maria.silva', senhaTemporaria: 'Tmp-123456', urlAcesso: 'https://sgo.exemplo/login' },
  criadoEm: '2026-10-26T12:00:00.000Z',
};

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroDominio);
    return (e as ErroDominio).codigo;
  }
}

describe('renderizarEmail', () => {
  it('assunto com as etiquetas do módulo (RN0006) e corpo com login, senha e link', () => {
    const r = renderizarEmail(base, { nomeExibicao: '' });
    expect(r.assunto).toBe('[SGO 2.0][Acesso] Seu acesso ao sistema');
    expect(r.texto).toContain('Login: maria.silva');
    expect(r.texto).toContain('Senha temporária: Tmp-123456');
    expect(r.texto).toContain('https://sgo.exemplo/login');
    expect(r.html).toContain('<a href="https://sgo.exemplo/login">');
  });

  it('sem nome de exibição, o cabeçalho é só o do sistema', () => {
    const r = renderizarEmail(base, { nomeExibicao: '   ' });
    expect(r.texto.split('\n')[0]).toBe('SGO 2.0 – Sistema de Gestão Orçamentária');
  });

  it('com nome de exibição, ele entra no cabeçalho', () => {
    const r = renderizarEmail(base, { nomeExibicao: 'Instituição Exemplo' });
    expect(r.texto.split('\n')[0]).toBe('SGO 2.0 – Sistema de Gestão Orçamentária · Instituição Exemplo');
  });

  it('o modelo de senha redefinida tem o próprio assunto', () => {
    const r = renderizarEmail({ ...base, modelo: 'usuario.senha_redefinida' }, { nomeExibicao: '' });
    expect(r.assunto).toBe('[SGO 2.0][Acesso] Sua senha foi redefinida');
  });

  it('escapa no HTML todo dado e o nome de exibição', () => {
    const r = renderizarEmail(
      { ...base, dados: { ...base.dados, nome: '<script>alert(1)</script>', login: 'a"b', senhaTemporaria: "x'&<y" } },
      { nomeExibicao: '<b>Inst</b>' },
    );
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>Inst</b>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).toContain('a&quot;b');
    expect(r.html).toContain('x&#39;&amp;&lt;y');
    expect(r.html).toContain('&lt;b&gt;Inst&lt;/b&gt;');
  });

  it('aspas no link não saem do atributo href', () => {
    const r = renderizarEmail(
      { ...base, dados: { ...base.dados, urlAcesso: 'https://sgo.exemplo/login" onclick="x' } },
      { nomeExibicao: '' },
    );
    expect(r.html).toContain('href="https://sgo.exemplo/login&quot; onclick=&quot;x"');
  });

  it('versão desconhecida → email.modelo_desconhecido', () => {
    expect(codigo(() => renderizarEmail({ ...base, versao: 99 }, { nomeExibicao: '' }))).toBe('email.modelo_desconhecido');
  });

  it('modelo desconhecido → email.modelo_desconhecido', () => {
    expect(codigo(() => renderizarEmail({ ...base, modelo: 'x.y' } as never, { nomeExibicao: '' }))).toBe('email.modelo_desconhecido');
  });

  it.each(['Inst\r\nBcc: x@y.org', 'Inst\u0000', 'x'.repeat(121)])('nome de exibição %j → erro', (nomeExibicao) => {
    expect(codigo(() => renderizarEmail(base, { nomeExibicao }))).toBe('email.nome_exibicao_invalido');
  });
});
