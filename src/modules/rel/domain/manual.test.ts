import { describe, expect, it } from 'vitest';
import { listarAcoes, montarManual, roteiroTreinamento, type ItemCatalogoManual } from './manual';

const item = (modulo: [string, string, number], grupo: string, codigo: string, nome: string, ordem: number, ajuda: string | null = null): ItemCatalogoManual => ({
  modulo: { codigo: modulo[0], nome: modulo[1], ordem: modulo[2] },
  grupo,
  funcionalidade: { codigo, nome, rota: `/${codigo.replace('.', '/')}`, ordem, ajuda },
});
const ADM: [string, string, number] = ['ADMINISTRACAO', 'Administração', 1];
const CAD: [string, string, number] = ['CADASTROS', 'Cadastros', 2];
const catalogo = [
  item(CAD, 'Plano de Contas', 'cad.plano_contas', 'Plano de Contas', 1, 'Consulte o plano.'),
  item(ADM, 'Operadores', 'adm.usuarios', 'Usuários', 2),
  item(ADM, 'Operadores', 'adm.perfis', 'Perfis', 1),
  item(['AUT', 'Tela', 0], 'Tela', 'aut.tela_principal', 'Tela principal', 1),
];

describe('manual por perfil (US-118)', () => {
  it('só o que a pessoa pode, na ordem do menu, com as ações na ordem canônica; sem a tela principal', () => {
    const manual = montarManual(catalogo, new Set(['cad.plano_contas:exportar', 'cad.plano_contas:consultar', 'adm.usuarios:consultar', 'aut.tela_principal:consultar']));
    expect(manual).toEqual([
      { nome: 'Administração', grupos: [{ nome: 'Operadores', funcionalidades: [{ codigo: 'adm.usuarios', nome: 'Usuários', rota: '/adm/usuarios', ajuda: null, acoes: ['consultar'] }] }] },
      {
        nome: 'Cadastros',
        grupos: [{ nome: 'Plano de Contas', funcionalidades: [{ codigo: 'cad.plano_contas', nome: 'Plano de Contas', rota: '/cad/plano_contas', ajuda: 'Consulte o plano.', acoes: ['consultar', 'exportar'] }] }],
      },
    ]);
  });

  it('sem permissão nenhuma, manual vazio', () => {
    expect(montarManual(catalogo, new Set())).toEqual([]);
  });

  it('roteiro: um passo por funcionalidade, com um exercício por ação', () => {
    const roteiro = roteiroTreinamento(montarManual(catalogo, new Set(['adm.perfis:consultar', 'adm.perfis:incluir', 'adm.usuarios:consultar'])));
    expect(roteiro.map((p) => [p.funcionalidade, p.local, p.exercicios.length])).toEqual([
      ['Perfis', 'Administração › Operadores', 2],
      ['Usuários', 'Administração › Operadores', 1],
    ]);
    expect(roteiro[0]!.exercicios[1]).toMatch(/^inclua um registro de teste/);
  });

  it('lista as ações em português', () => {
    expect(listarAcoes(['consultar'])).toBe('consultar');
    expect(listarAcoes(['consultar', 'incluir', 'alterar'])).toBe('consultar, incluir e alterar');
    expect(listarAcoes([])).toBe('');
  });
});
