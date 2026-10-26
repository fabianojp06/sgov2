import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListaUsuarios, statusUsuario } from './lista-usuarios';

const usuarios = [
  { id: 'a1', nome: 'Ana Maria', login: 'ana', ativo: true, bloqueado: false },
  { id: 'b2', nome: 'Bruno Lima', login: 'bruno', ativo: true, bloqueado: true },
  { id: 'c3', nome: 'Carla Dias', login: 'carla', ativo: false, bloqueado: false },
];

const html = (props: Partial<Parameters<typeof ListaUsuarios>[0]> = {}) =>
  renderToString(createElement(ListaUsuarios, { usuarios, podeIncluir: true, podeAlterar: true, ...props }));

// UC02.11: listagem com Nome e Status (REQ0078), o bloqueio visível no status.
describe('ListaUsuarios', () => {
  it('colunas Nome e Status, um link por usuário para a alteração', () => {
    const h = html();
    expect(h).toMatch(/<th[^>]*>Nome<\/th>/);
    expect(h).toMatch(/<th[^>]*>Status<\/th>/);
    expect(h).toContain('href="/adm/usuarios/a1"');
    expect(h).toContain('Ana Maria');
  });

  it('status mostra ativo, inativo e o bloqueio', () => {
    expect(statusUsuario(usuarios[0]!)).toBe('Ativo');
    expect(statusUsuario(usuarios[1]!)).toBe('Ativo (bloqueado)');
    expect(statusUsuario(usuarios[2]!)).toBe('Inativo');
    expect(statusUsuario({ ativo: false, bloqueado: true })).toBe('Inativo (bloqueado)');
    expect(html()).toContain('Ativo (bloqueado)');
  });

  it('sem a permissão de alterar: nomes sem link (a alteração daria 404)', () => {
    const h = html({ podeAlterar: false });
    expect(h).toContain('Ana Maria');
    expect(h).not.toContain('href="/adm/usuarios/a1"');
  });

  it('botão Novo só com a permissão de incluir', () => {
    expect(html()).toContain('href="/adm/usuarios/novo"');
    expect(html({ podeIncluir: false })).not.toContain('href="/adm/usuarios/novo"');
  });

  it('aviso conhecido aparece como status; código desconhecido é ignorado', () => {
    expect(html({ aviso: 'alterado' })).toContain('Alteração no cadastro do usuário realizada com sucesso');
    expect(html({ aviso: 'alterado' })).toContain('role="status"');
    expect(html({ aviso: '<script>' })).not.toContain('role="status"');
  });

  it('lista vazia: texto próprio', () => expect(html({ usuarios: [] })).toContain('Nenhum usuário cadastrado.'));
});
