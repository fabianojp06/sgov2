import { describe, expect, it } from 'vitest';
import {
  alternarAcao,
  alternarFuncionalidade,
  alternarModulo,
  colunasDoModulo,
  estadoFuncionalidade,
  estadoInicial,
  estadoModulo,
  paraEntrada,
  type ModuloGrade,
} from './grade-permissoes';

// Grade de permissões do formulário de perfil (US-037; UC02.25/26 A2 e A3, RN0058; D-P13-4, D-P13-12).
const ORC: ModuloGrade = {
  modulo: 'ORCAMENTARIO',
  nome: 'Orçamentário',
  funcionalidades: [
    { codigo: 'orc.orcamento', nome: 'Orçamento', grupo: 'G', acoes: ['consultar', 'alterar'], fixas: [] },
    { codigo: 'orc.pacotes', nome: 'Pacotes', grupo: 'G', acoes: ['consultar', 'incluir', 'excluir'], fixas: [] },
  ],
};
const ADM: ModuloGrade = {
  modulo: 'ADMINISTRACAO',
  nome: 'Administração',
  funcionalidades: [{ codigo: 'adm.perfis', nome: 'Perfis', grupo: 'G', acoes: ['consultar', 'incluir'], fixas: ['consultar', 'incluir'] }],
};
const acoes = (e: ReturnType<typeof estadoInicial>, f: string) => [...(e.get(f) ?? [])].sort();

describe('grade de permissões', () => {
  it('cadastro começa sem nada marcado (RN0058)', () => {
    const e = estadoInicial([ORC]);
    expect(estadoModulo(e, ORC)).toBe('desmarcado');
    expect(paraEntrada(e, [ORC])).toEqual({ permissoes: [], exibidas: ['orc.orcamento', 'orc.pacotes'] });
  });

  it('A2: marcar o módulo marca todas as funcionalidades e ações; A3: desmarcar desmarca tudo', () => {
    const marcado = alternarModulo(estadoInicial([ORC]), ORC, true);
    expect(estadoModulo(marcado, ORC)).toBe('marcado');
    expect(acoes(marcado, 'orc.pacotes')).toEqual(['consultar', 'excluir', 'incluir']);
    expect(estadoModulo(alternarModulo(marcado, ORC, false), ORC)).toBe('desmarcado');
  });

  it('módulo indeterminado com parte marcada; funcionalidade também', () => {
    const e = alternarAcao(estadoInicial([ORC]), ORC.funcionalidades[1]!, 'incluir', true);
    expect(estadoModulo(e, ORC)).toBe('indeterminado');
    expect(estadoFuncionalidade(e, ORC.funcionalidades[1]!)).toBe('indeterminado');
    expect(estadoFuncionalidade(alternarFuncionalidade(e, ORC.funcionalidades[1]!, true), ORC.funcionalidades[1]!)).toBe('marcado');
  });

  it('marcar uma ação marca Consultar; desmarcar Consultar desmarca a funcionalidade inteira', () => {
    const f = ORC.funcionalidades[1]!;
    const e = alternarAcao(estadoInicial([ORC]), f, 'excluir', true);
    expect(acoes(e, 'orc.pacotes')).toEqual(['consultar', 'excluir']);
    expect(acoes(alternarAcao(e, f, 'excluir', false), 'orc.pacotes')).toEqual(['consultar']);
    expect(acoes(alternarAcao(e, f, 'consultar', false), 'orc.pacotes')).toEqual([]);
  });

  it('as adm.* fixas do Administrador ficam marcadas, não mudam e não vão no formulário', () => {
    const e = estadoInicial([ADM, ORC], [{ funcionalidade: 'orc.orcamento', acoes: ['consultar'] }]);
    expect(estadoModulo(e, ADM)).toBe('marcado');
    const tentativa = alternarAcao(alternarModulo(e, ADM, false), ADM.funcionalidades[0]!, 'consultar', false);
    expect(acoes(tentativa, 'adm.perfis')).toEqual(['consultar', 'incluir']);
    expect(paraEntrada(tentativa, [ADM, ORC])).toEqual({ permissoes: [{ funcionalidade: 'orc.orcamento', acoes: ['consultar'] }], exibidas: ['orc.orcamento', 'orc.pacotes'] });
  });

  it('alteração parte das permissões atuais; ações na ordem do C5; colunas só as declaradas no módulo', () => {
    const e = estadoInicial([ORC], [{ funcionalidade: 'orc.pacotes', acoes: ['excluir', 'consultar', 'voar'] }]);
    expect(paraEntrada(e, [ORC]).permissoes).toEqual([{ funcionalidade: 'orc.pacotes', acoes: ['consultar', 'excluir'] }]);
    expect(colunasDoModulo(ORC).map(([a]) => a)).toEqual(['consultar', 'incluir', 'alterar', 'excluir']);
  });
});
