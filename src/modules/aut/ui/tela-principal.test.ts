import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AjudaConteudo } from './ajuda';
import { ErroCarregamento } from './erro-carregamento';
import { SeletorUnidade } from './seletor-unidade';
import { TelaPrincipal } from './tela-principal';

const menu = [
  { codigo: 'ADMINISTRACAO', nome: 'Administração', grupos: [{ nome: 'Operadores e Permissões', itens: [{ codigo: 'adm.usuarios', nome: 'Usuários', rota: '/adm/usuarios', ajuda: 'Texto de ajuda' }] }] },
];
const trocarUnidade = async () => ({ ok: true as const });
const base = {
  usuario: { nome: 'Ana Maria', acessoEm: '2026-11-11T12:00:00.000Z' },
  unidades: [],
  unidadeAtiva: null,
  trocarUnidade,
};

describe('TelaPrincipal (UC01.03)', () => {
  it('barra com o nome do sistema, usuário, data e hora do acesso, Ajuda, Alterar senha e Sair (REQ0046)', () => {
    const html = renderToString(createElement(TelaPrincipal, { ...base, menu }, 'conteúdo'));
    expect(html).toContain('SGO 2.0 – Sistema de Gestão Orçamentária');
    expect(html).toContain('Ana Maria');
    expect(html).toContain('11/11/2026');
    expect(html).toContain('Ajuda');
    expect(html).toMatch(/href="\/troca-senha"[^>]*>Alterar senha/);
    expect(html).toContain('Sair');
    expect(html).toContain('Usuários');
    expect(html).toContain('conteúdo');
  });

  it('menu vazio: mensagem do RN0521, sem redirecionar', () => {
    const html = renderToString(createElement(TelaPrincipal, { ...base, menu: [] }));
    expect(html).toContain('Nenhuma funcionalidade disponível para o seu perfil de acesso. Contate o Administrador.');
  });
});

describe('SeletorUnidade (§6.7)', () => {
  const u = (id: string) => ({ id, codigo: id, nome: `TP ${id}` });
  it('com 0 ou 1 unidade não aparece', () => {
    expect(renderToString(createElement(SeletorUnidade, { unidades: [], unidadeAtiva: null, trocar: trocarUnidade }))).toBe('');
    expect(renderToString(createElement(SeletorUnidade, { unidades: [u('a')], unidadeAtiva: 'a', trocar: trocarUnidade }))).toBe('');
  });
  it('com 2, um select com as duas', () => {
    const html = renderToString(createElement(SeletorUnidade, { unidades: [u('a'), u('b')], unidadeAtiva: 'b', trocar: trocarUnidade }));
    expect(html).toContain('<select');
    expect(html).toContain('TP a');
    expect(html).toContain('TP b');
  });
});

describe('AjudaConteudo (RN0032)', () => {
  it('com conteúdo, mostra o texto da funcionalidade', () =>
    expect(renderToString(createElement(AjudaConteudo, { menu, caminho: '/adm/usuarios/novo' }))).toContain('Texto de ajuda'));
  it('sem conteúdo, mensagem do E3', () =>
    expect(renderToString(createElement(AjudaConteudo, { menu, caminho: '/inicio' }))).toContain(
      'Conteúdo de ajuda não disponível para esta funcionalidade.',
    ));
});

describe('ErroCarregamento (UC01.03 E1, E2)', () => {
  it.each([
    ['modulos', 'Não foi possível carregar os módulos do sistema. Tente novamente ou contate o Administrador.'],
    ['permissoes', 'Não foi possível carregar suas permissões de acesso. Tente novamente ou contate o Administrador.'],
  ] as const)('%s', (tipo, mensagem) => {
    const html = renderToString(createElement(ErroCarregamento, { tipo }));
    expect(html).toContain(mensagem);
    expect(html).toContain('Tentar novamente');
    expect(html).toContain('Sair');
  });
});

describe('error.tsx do (sistema)', () => {
  it('usa o ErroCarregamento de módulos', async () => {
    const { default: Erro } = await import('../../../app/(sistema)/error');
    const html = renderToString(createElement(Erro, { error: new Error('x'), reset: () => {} }));
    expect(html).toContain('Não foi possível carregar os módulos do sistema.');
  });
});
