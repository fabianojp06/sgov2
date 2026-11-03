import { describe, expect, it } from 'vitest';
import { MODULOS_MENU, validarDeclaracoes, type DeclaracaoFuncionalidade } from './catalogo';

const base: DeclaracaoFuncionalidade = {
  codigo: 'cad.cargos',
  modulo: 'CADASTROS',
  grupo: 'Pessoal',
  nome: 'Cargos',
  rota: '/cad/cargos',
  ordem: 1,
  acoes: ['consultar', 'incluir'],
  perfisPadrao: { ANALISTA_GRH: ['consultar', 'incluir'], AUDITOR: ['consultar'] },
};

describe('catálogo de funcionalidades (contrato C6)', () => {
  it('os 6 módulos de menu da spec §6.7, em ordem', () =>
    expect(MODULOS_MENU.map((m) => m.codigo)).toEqual([
      'ADMINISTRACAO',
      'CADASTROS',
      'ORCAMENTARIO',
      'ADM_CENTRAL',
      'RELATORIOS',
      'APROVACOES',
    ]));

  it('declaração válida passa', () => expect(() => validarDeclaracoes([base])).not.toThrow());

  it('exibirNoMenu: false aceito (funcionalidade com permissão, fora do menu)', () =>
    expect(() => validarDeclaracoes([{ ...base, exibirNoMenu: false }])).not.toThrow());

  it('exibirNoMenu que não é booleano', () =>
    expect(() =>
      validarDeclaracoes([{ ...base, exibirNoMenu: 'nao' as unknown as boolean }]),
    ).toThrow(expect.objectContaining({ codigo: 'seed.exibir_no_menu_invalido' })));

  it('módulo ADMINISTRACAO só para o ADMINISTRADOR (RN_SEED_003, R10)', () =>
    expect(() =>
      validarDeclaracoes([{ ...base, codigo: 'adm.y', modulo: 'ADMINISTRACAO', perfisPadrao: { AUDITOR: ['consultar'] } }]),
    ).toThrow(expect.objectContaining({ codigo: 'seed.perfil_proibido' })));

  it('ação padrão fora das ações da funcionalidade', () =>
    expect(() => validarDeclaracoes([{ ...base, perfisPadrao: { AUDITOR: ['excluir'] } }])).toThrow(
      expect.objectContaining({ codigo: 'seed.acao_invalida' }),
    ));

  it('módulo de menu desconhecido', () =>
    // @ts-expect-error módulo fora de CodigoModuloMenu (o tipo pega o erro de digitação)
    expect(() => validarDeclaracoes([{ ...base, modulo: 'XPTO' }])).toThrow(
      expect.objectContaining({ codigo: 'seed.modulo_invalido' }),
    ));

  it('código fora do formato <mod>.<nome>', () =>
    expect(() => validarDeclaracoes([{ ...base, codigo: 'Cargos' }])).toThrow(expect.objectContaining({ codigo: 'seed.codigo_invalido' })));

  it('código adm.* fora do módulo ADMINISTRACAO (RN_SEED_003)', () =>
    expect(() => validarDeclaracoes([{ ...base, codigo: 'adm.x' }])).toThrow(
      expect.objectContaining({ codigo: 'seed.perfil_proibido' }),
    ));

  it('ação repetida na declaração', () =>
    expect(() => validarDeclaracoes([{ ...base, acoes: ['consultar', 'consultar'] }])).toThrow(
      expect.objectContaining({ codigo: 'seed.acao_invalida' }),
    ));

  it('código duplicado', () =>
    expect(() => validarDeclaracoes([base, base])).toThrow(expect.objectContaining({ codigo: 'seed.codigo_duplicado' })));

  it('perfil desconhecido', () =>
    expect(() =>
      validarDeclaracoes([{ ...base, perfisPadrao: { XPTO: ['consultar'] } as DeclaracaoFuncionalidade['perfisPadrao'] }]),
    ).toThrow(expect.objectContaining({ codigo: 'seed.perfil_invalido' })));
});
