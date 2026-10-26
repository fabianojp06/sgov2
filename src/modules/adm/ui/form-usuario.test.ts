import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AcaoConfirmada } from './acao-confirmada';
import { FormUsuario, MENSAGEM_BLOQUEADO, type PropsFormUsuario } from './form-usuario';

const acao = async () => ({ ok: true as const, valor: undefined });
const opcoes = {
  perfis: [
    { codigo: 'ADMINISTRADOR', nome: 'Administrador', ativo: true },
    { codigo: 'ORCAMENTISTA', nome: 'Orçamentista', ativo: true },
    { codigo: 'ANTIGO', nome: 'Perfil antigo', ativo: false },
  ],
  unidades: [{ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', nome: 'TP 1', ativo: true }],
};
const usuario = {
  id: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  nome: 'Ana Maria',
  email: 'ana@example.org',
  login: 'ana.maria',
  ativo: true,
  bloqueado: false,
  perfis: ['ORCAMENTISTA'],
  unidades: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'],
  ccEscopo: null,
  versao: 4,
};

const html = (props: Partial<PropsFormUsuario> = {}) => renderToString(createElement(FormUsuario, { opcoes, salvar: acao, ...props }));
// O React serializa o checked antes do value: confere a tag inteira do input.
const marcado = (h: string, valor: string) => new RegExp(`<input[^>]*value="${valor}"[^>]*>`).exec(h)?.[0].includes('checked') ?? false;
const alteracao = (u: Partial<typeof usuario> = {}) =>
  html({ usuario: { ...usuario, ...u }, resetarSenha: acao, desbloquear: acao });

describe('FormUsuario: cadastro (UC02.12)', () => {
  it('campos nome, e-mail, login, status, perfis, TPs e CC de escopo; login editável', () => {
    const h = html();
    for (const nome of ['nome', 'email', 'login', 'ativo', 'perfis', 'unidades', 'ccEscopo']) expect(h).toContain(`name="${nome}"`);
    expect(h).not.toMatch(/name="login"[^>]*disabled/);
  });

  it('não existe campo de senha (RN0059)', () => {
    expect(html()).not.toMatch(/type="password"|name="senha/i);
    expect(alteracao()).not.toMatch(/type="password"|name="senha/i);
  });

  it('status ativo marcado por padrão; perfil inativo não é oferecido no cadastro', () => {
    expect(/<input[^>]*name="ativo"[^>]*>/.exec(html())?.[0]).toContain('checked');
    expect(html()).not.toContain('Perfil antigo');
  });

  it('sem Resetar Senha nem Desbloquear no cadastro; Cancelar volta à listagem', () => {
    const h = html();
    expect(h).not.toContain('Resetar Senha');
    expect(h).not.toContain('Desbloquear');
    expect(h).toContain('href="/adm/usuarios"');
  });
});

describe('FormUsuario: alteração (UC02.13)', () => {
  it('login desabilitado (RN0066), id e versão ocultos, dados preenchidos', () => {
    const h = alteracao();
    expect(h).toMatch(/name="login"[^>]*disabled|disabled[^>]*name="login"/);
    expect(h).toMatch(/type="hidden" name="id" value="0b1e6f1a/);
    expect(h).toMatch(/type="hidden" name="versao" value="4"/);
    expect(h).toContain('value="Ana Maria"');
    expect(marcado(h, 'ORCAMENTISTA')).toBe(true);
    expect(marcado(h, 'ADMINISTRADOR')).toBe(false);
  });

  it('perfil inativo já vinculado aparece marcado e identificado', () => {
    const h = alteracao({ perfis: ['ANTIGO', 'ORCAMENTISTA'] });
    expect(h).toContain('Perfil antigo (inativo)');
    expect(marcado(h, 'ANTIGO')).toBe(true);
  });

  it('bloqueado: mensagem do RN0052 e Desbloquear (bloqueado e ativo, RN0063)', () => {
    const h = alteracao({ bloqueado: true });
    expect(h).toContain(MENSAGEM_BLOQUEADO);
    expect(h).toContain('Desbloquear');
  });

  it('desbloqueado, ou bloqueado e inativo: sem Desbloquear', () => {
    expect(alteracao()).not.toContain('Desbloquear');
    expect(alteracao()).not.toContain(MENSAGEM_BLOQUEADO);
    const inativo = alteracao({ bloqueado: true, ativo: false });
    expect(inativo).toContain(MENSAGEM_BLOQUEADO);
    expect(inativo).not.toContain('Desbloquear');
  });

  it('Resetar Senha disponível na alteração', () => expect(alteracao()).toContain('Resetar Senha'));
});

describe('AcaoConfirmada (UC02.13 A2, A3)', () => {
  const props = { rotulo: 'Resetar Senha', pergunta: 'Deseja realmente resetar a senha deste usuário?', acao, id: 'x' };
  it('fechada: só o botão', () => {
    const h = renderToString(createElement(AcaoConfirmada, props));
    expect(h).toContain('Resetar Senha');
    expect(h).not.toContain('Deseja realmente');
  });
  it('aberta: pergunta com Sim e Não', () => {
    const h = renderToString(createElement(AcaoConfirmada, { ...props, aberto: true }));
    expect(h).toContain('role="alertdialog"');
    expect(h).toContain('Deseja realmente resetar a senha deste usuário?');
    expect(h).toContain('>Sim<');
    expect(h).toContain('>Não<');
  });
});
