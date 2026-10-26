import { describe, expect, it } from 'vitest';
import { ajudaDaRota, filtrarMenu, montarMenu, type ItemCatalogo } from './menu';

const item = (modulo: [string, string, number], grupo: string, codigo: string, nome: string, rota: string, ordem = 1, ajuda: string | null = null): ItemCatalogo => ({
  modulo: { codigo: modulo[0], nome: modulo[1], ordem: modulo[2] },
  grupo,
  funcionalidade: { codigo, nome, rota, ordem, ajuda },
});
const ADM: [string, string, number] = ['ADMINISTRACAO', 'Administração', 1];
const CAD: [string, string, number] = ['CADASTROS', 'Cadastros', 2];
const ADMC: [string, string, number] = ['ADM_CENTRAL', 'Administração Central', 4];

const catalogo: ItemCatalogo[] = [
  item(CAD, 'Pessoal', 'cad.cargos', 'Cargos', '/cad/cargos', 2),
  item(ADM, 'Operadores e Permissões', 'adm.usuarios', 'Usuários', '/adm/usuarios', 1, 'Cadastre e altere usuários.'),
  item(CAD, 'Plano de Contas', 'cad.plano', 'Plano de Contas', '/cad/plano', 1),
  item(ADMC, 'Orçamento', 'orc.admc', 'Orçamento da Adm. Central', '/orc/admc', 1),
];

describe('montarMenu (RN0027, RN0030, RN0031, R11)', () => {
  it('Administração › Operadores e Permissões › Usuários para o administrador', () =>
    expect(montarMenu(catalogo, new Set(['adm.usuarios:consultar']))).toEqual([
      {
        codigo: 'ADMINISTRACAO',
        nome: 'Administração',
        grupos: [{ nome: 'Operadores e Permissões', itens: [{ codigo: 'adm.usuarios', nome: 'Usuários', rota: '/adm/usuarios', ajuda: 'Cadastre e altere usuários.' }] }],
      },
    ]));

  it('qualquer ação dá o item (R11); módulos e grupos na ordem', () => {
    const m = montarMenu(catalogo, new Set(['cad.cargos:incluir', 'cad.plano:consultar']));
    expect(m.map((x) => x.codigo)).toEqual(['CADASTROS']);
    expect(m[0]?.grupos.map((g) => g.nome)).toEqual(['Plano de Contas', 'Pessoal']);
  });

  it('Administração Central só para quem tem a permissão', () => {
    expect(montarMenu(catalogo, new Set(['cad.cargos:consultar'])).some((x) => x.codigo === 'ADM_CENTRAL')).toBe(false);
    expect(montarMenu(catalogo, new Set(['orc.admc:aprovar'])).map((x) => x.codigo)).toEqual(['ADM_CENTRAL']);
  });

  it('sem permissão nenhuma → menu vazio (RN0521)', () => expect(montarMenu(catalogo, new Set())).toEqual([]));

  it('permissões básicas (aut.*) nunca viram item', () =>
    expect(montarMenu([...catalogo, item(ADM, 'x', 'aut.senha', 'Senha', '/troca-senha')], new Set(['aut.senha:alterar']))).toEqual([]));

  it('prefixo não confunde funcionalidades (cad.cargo × cad.cargos)', () =>
    expect(montarMenu(catalogo, new Set(['cad.cargo:consultar']))).toEqual([]));
});

describe('filtrarMenu', () => {
  const menu = montarMenu(catalogo, new Set(['adm.usuarios:consultar', 'cad.plano:consultar']));
  it('sem acento e sem caixa', () => expect(filtrarMenu(menu, 'USUARIO')[0]?.grupos[0]?.itens[0]?.codigo).toBe('adm.usuarios'));
  it('não acha o que não tem permissão', () => expect(filtrarMenu(menu, 'cargos')).toEqual([]));
  it('termo vazio devolve o menu inteiro', () => expect(filtrarMenu(menu, '  ')).toEqual(menu));
});

describe('ajudaDaRota (RN0032)', () => {
  const menu = montarMenu(catalogo, new Set(['adm.usuarios:consultar']));
  it('subcaminho cai na funcionalidade', () => expect(ajudaDaRota(menu, '/adm/usuarios/novo')?.codigo).toBe('adm.usuarios'));
  it('rota parecida não casa', () => expect(ajudaDaRota(menu, '/adm/usuariosx')).toBeNull());
  it('/inicio → null', () => expect(ajudaDaRota(menu, '/inicio')).toBeNull());
});
