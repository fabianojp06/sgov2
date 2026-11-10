import { describe, expect, it } from 'vitest';
import {
  conferirPermissoes,
  diferencaPermissoes,
  funcionalidadesDaGrade,
  MENSAGENS_PERFIL,
  mensagemSemConsultar,
  temFuncionalidadeAtiva,
  validarPerfil,
  type FuncionalidadeCatalogo,
} from './perfil';
import { AVISO_SEM_ESCOPO, precisaAvisoSemEscopo } from './perfil-textos';
import { CODIGOS_PERFIL, ehPerfilPadrao, FORMATO_CODIGO_PERFIL, gerarCodigoPerfil, podeReceberFuncionalidade, PREFIXO_PERFIL_TELA } from './perfis';

// Regras puras do cadastro de perfis (US-037; plano do P13, D-P13-2 a D-P13-6 e ajustes A1, A2, A3, A5).
const entrada = (extra: Record<string, unknown> = {}) => ({
  nome: 'Consulta Orçamento',
  descricao: '',
  ativo: true,
  permissoes: [{ funcionalidade: 'orc.orcamento', acoes: ['consultar'] }],
  exibidas: ['orc.orcamento'],
  ...extra,
});
const erro = (r: ReturnType<typeof validarPerfil>) => (r.ok ? null : r.erros.map((e) => [e.campo, e.mensagem]));

const f = (codigo: string, modulo: string, acoes: string[], ativa = true): FuncionalidadeCatalogo => ({ codigo, nome: `Tela ${codigo}`, modulo, acoes, ativa });
const CATALOGO = [
  f('adm.usuarios', 'ADMINISTRACAO', ['consultar', 'incluir', 'alterar']),
  f('adm.historico', 'ADMINISTRACAO', ['consultar', 'exportar', 'imprimir']),
  f('orc.orcamento', 'ORCAMENTARIO', ['consultar', 'alterar']),
  f('orc.pacotes', 'ORCAMENTARIO', ['consultar', 'incluir']),
  f('cad.parado', 'CADASTROS', ['consultar'], false),
  f('rel.sem_acao', 'RELATORIOS', []),
];
const P = 'P_ABCDEF012345';

describe('validarPerfil (D-P13-5)', () => {
  it('nome em branco, só espaços e com 101 caracteres', () => {
    expect(erro(validarPerfil(entrada({ nome: '' })))).toEqual([['nome', MENSAGENS_PERFIL.NOME]]);
    expect(erro(validarPerfil(entrada({ nome: '   ' })))).toEqual([['nome', MENSAGENS_PERFIL.NOME]]);
    expect(erro(validarPerfil(entrada({ nome: 'x'.repeat(101) })))).toEqual([['nome', MENSAGENS_PERFIL.NOME_TAMANHO]]);
    expect(erro(validarPerfil(entrada({ nome: 'a\nb' })))).toEqual([['nome', MENSAGENS_PERFIL.NOME_TAMANHO]]);
  });

  it('nome com espaço interno passa, aparado (A10)', () => {
    const r = validarPerfil(entrada({ nome: '  Gestor  Financeiro ', descricao: undefined }));
    expect(r.ok && r.valor).toMatchObject({ nome: 'Gestor  Financeiro', descricao: '' });
  });

  it('descrição de 501 caracteres', () => expect(erro(validarPerfil(entrada({ descricao: 'd'.repeat(501) })))).toEqual([['descricao', MENSAGENS_PERFIL.DESCRICAO]]));

  it('funcionalidade repetida (RN0084) e ação fora do C5', () => {
    const repetida = [
      { funcionalidade: 'orc.orcamento', acoes: ['consultar'] },
      { funcionalidade: 'orc.orcamento', acoes: ['alterar'] },
    ];
    expect(erro(validarPerfil(entrada({ permissoes: repetida })))).toEqual([['permissoes', MENSAGENS_PERFIL.PERMISSAO_REPETIDA]]);
    expect(erro(validarPerfil(entrada({ permissoes: [{ funcionalidade: 'orc.orcamento', acoes: ['voar'] }] })))).toEqual([
      ['permissoes', MENSAGENS_PERFIL.ACAO_INVALIDA],
    ]);
  });

  it('funcionalidade sem ação sai da lista; ações ficam na ordem do C5', () => {
    const r = validarPerfil(
      entrada({
        permissoes: [
          { funcionalidade: 'orc.orcamento', acoes: ['alterar', 'consultar'] },
          { funcionalidade: 'orc.pacotes', acoes: [] },
        ],
      }),
    );
    expect(r.ok && r.valor.permissoes).toEqual([{ funcionalidade: 'orc.orcamento', acoes: ['consultar', 'alterar'] }]);
  });

  it('status ausente recebe mensagem em português', () => expect(erro(validarPerfil(entrada({ ativo: undefined })))).toEqual([['ativo', MENSAGENS_PERFIL.STATUS]]));
});

describe('conferirPermissoes (RN0046, RN0078, RN_SEED_003; ajustes A1 e A2)', () => {
  const conferir = (perfil: string, permissoes: { funcionalidade: string; acoes: ('consultar' | 'alterar' | 'incluir' | 'exportar')[] }[], exibidas?: string[]) =>
    conferirPermissoes(perfil, permissoes, exibidas ?? funcionalidadesDaGrade(perfil, CATALOGO).map((x) => x.codigo), CATALOGO);
  const mensagem = (r: ReturnType<typeof conferir>) => (r.ok ? null : r.erros[0]?.mensagem);

  it('grade: só ativas, com ação, que o perfil pode receber; sem as fixas do Administrador', () => {
    expect(funcionalidadesDaGrade(P, CATALOGO).map((x) => x.codigo)).toEqual(['orc.orcamento', 'orc.pacotes']);
    expect(funcionalidadesDaGrade('AUDITOR', CATALOGO).map((x) => x.codigo)).toEqual(['adm.historico', 'orc.orcamento', 'orc.pacotes']);
    expect(funcionalidadesDaGrade('ADMINISTRADOR', CATALOGO).map((x) => x.codigo)).toEqual(['orc.orcamento', 'orc.pacotes']);
  });

  it('válida passa e devolve a grade', () => {
    const r = conferir(P, [{ funcionalidade: 'orc.orcamento', acoes: ['consultar', 'alterar'] }]);
    expect(r.ok && [...r.valor.grade]).toEqual(['orc.orcamento', 'orc.pacotes']);
  });

  it('ação não declarada na funcionalidade (RN0046)', () =>
    expect(mensagem(conferir(P, [{ funcionalidade: 'orc.pacotes', acoes: ['consultar', 'exportar'] }]))).toBe(MENSAGENS_PERFIL.ACAO_INVALIDA));

  it('ação sem Consultar (D-P13-5)', () => expect(mensagem(conferir(P, [{ funcionalidade: 'orc.orcamento', acoes: ['alterar'] }]))).toBe(mensagemSemConsultar('Tela orc.orcamento')));

  it('funcionalidade inativa, inexistente ou sem ação (RN0078)', () => {
    expect(mensagem(conferir(P, [{ funcionalidade: 'cad.parado', acoes: ['consultar'] }]))).toBe(MENSAGENS_PERFIL.FUNCIONALIDADE_INVALIDA);
    expect(mensagem(conferir(P, [{ funcionalidade: 'xxx.nada', acoes: ['consultar'] }]))).toBe(MENSAGENS_PERFIL.FUNCIONALIDADE_INVALIDA);
  });

  it('Administração: recusada ao perfil da tela e a padrão que não o Administrador; adm.historico só ao Auditor', () => {
    expect(mensagem(conferir(P, [{ funcionalidade: 'adm.usuarios', acoes: ['consultar'] }]))).toBe(MENSAGENS_PERFIL.ADMINISTRACAO_EXCLUSIVA);
    expect(mensagem(conferir('GFIN', [{ funcionalidade: 'adm.historico', acoes: ['consultar'] }]))).toBe(MENSAGENS_PERFIL.ADMINISTRACAO_EXCLUSIVA);
    expect(conferir('AUDITOR', [{ funcionalidade: 'adm.historico', acoes: ['consultar'] }]).ok).toBe(true);
  });

  it('Administrador: as adm.* pedidas ficam fora (A2), sem erro', () => {
    const r = conferir('ADMINISTRADOR', [
      { funcionalidade: 'adm.usuarios', acoes: ['consultar'] },
      { funcionalidade: 'orc.orcamento', acoes: ['consultar'] },
    ]);
    expect(r.ok && [...r.valor.grade]).toEqual(['orc.orcamento', 'orc.pacotes']);
  });

  it('exibidas diferente da grade do servidor → conflito (A1)', () => {
    const p = [{ funcionalidade: 'orc.orcamento', acoes: ['consultar'] as 'consultar'[] }];
    expect(mensagem(conferir(P, p, ['orc.orcamento']))).toBe(MENSAGENS_PERFIL.ALTERADO);
    expect(mensagem(conferir(P, p, ['orc.orcamento', 'orc.pacotes', 'cad.parado']))).toBe(MENSAGENS_PERFIL.ALTERADO);
    expect(conferir(P, p, ['orc.pacotes', 'orc.orcamento']).ok).toBe(true);
  });
});

describe('diferencaPermissoes (RN0080, RN0081; D-P13-6)', () => {
  const grade = new Set(['orc.orcamento', 'orc.pacotes', 'cad.um']);

  it('associadas, retiradas e ações mudadas, só sobre a grade; as de fora ficam como estavam', () => {
    const d = diferencaPermissoes(
      { 'orc.orcamento': ['consultar'], 'cad.um': ['consultar'], 'cad.parado': ['consultar'], 'adm.usuarios': ['consultar'] },
      [
        { funcionalidade: 'orc.orcamento', acoes: ['consultar', 'alterar'] },
        { funcionalidade: 'orc.pacotes', acoes: ['consultar'] },
      ],
      grade,
    );
    expect(d.associadas).toEqual([{ funcionalidade: 'orc.pacotes', acoes: ['consultar'] }]);
    expect(d.retiradas).toEqual([{ funcionalidade: 'cad.um', acoes: ['consultar'] }]);
    expect(d.alteradas).toEqual([{ funcionalidade: 'orc.orcamento', antes: ['consultar'], depois: ['consultar', 'alterar'] }]);
    expect(d.final).toEqual({
      'adm.usuarios': ['consultar'],
      'cad.parado': ['consultar'],
      'orc.orcamento': ['consultar', 'alterar'],
      'orc.pacotes': ['consultar'],
    });
  });

  it('sem mudança: listas vazias', () => {
    const d = diferencaPermissoes({ 'orc.orcamento': ['alterar', 'consultar'] }, [{ funcionalidade: 'orc.orcamento', acoes: ['consultar', 'alterar'] }], grade);
    expect([d.associadas, d.retiradas, d.alteradas]).toEqual([[], [], []]);
  });

  it('RN0082 conta só as ativas', () => {
    expect(temFuncionalidadeAtiva({ 'cad.parado': ['consultar'] }, new Set(['orc.orcamento']))).toBe(false);
    expect(temFuncionalidadeAtiva({ 'orc.orcamento': ['consultar'] }, new Set(['orc.orcamento']))).toBe(true);
  });
});

describe('códigos e RN_SEED_003 (D-P13-2, D-P13-4, A5)', () => {
  it('podeReceberFuncionalidade', () => {
    expect(podeReceberFuncionalidade('ADMINISTRADOR', 'adm.usuarios', 'ADMINISTRACAO')).toBe(true);
    expect(podeReceberFuncionalidade('AUDITOR', 'adm.historico', 'ADMINISTRACAO')).toBe(true);
    expect(podeReceberFuncionalidade('AUDITOR', 'adm.usuarios', 'ADMINISTRACAO')).toBe(false);
    expect(podeReceberFuncionalidade(P, 'adm.historico', 'ADMINISTRACAO')).toBe(false);
    expect(podeReceberFuncionalidade(P, 'adm.x', 'CADASTROS')).toBe(false);
    expect(podeReceberFuncionalidade(P, 'orc.orcamento', 'ORCAMENTARIO')).toBe(true);
  });

  it('código gerado: P_ + 12 hexadecimais maiúsculos, no formato e fora dos padrões', () => {
    const c = gerarCodigoPerfil('0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c');
    expect(c).toBe('P_0B1E6F1A5C39');
    expect(FORMATO_CODIGO_PERFIL.test(gerarCodigoPerfil())).toBe(true);
    expect(ehPerfilPadrao(c)).toBe(false);
    expect(ehPerfilPadrao('AUDITOR')).toBe(true);
  });

  it('nenhum código padrão usa o prefixo reservado aos perfis da tela, e todos estão no formato', () => {
    expect(CODIGOS_PERFIL.filter((c) => c.startsWith(PREFIXO_PERFIL_TELA))).toEqual([]);
    expect(CODIGOS_PERFIL.every((c) => FORMATO_CODIGO_PERFIL.test(c))).toBe(true);
  });
});

describe('aviso de perfil sem CC de escopo (C25, A3)', () => {
  it('perfil da tela que lança em pacotes ou posições recebe o aviso; padrão e só consulta não', () => {
    expect(precisaAvisoSemEscopo(false, [{ funcionalidade: 'orc.pacotes', acoes: ['consultar', 'incluir'] }])).toBe(true);
    expect(precisaAvisoSemEscopo(false, [{ funcionalidade: 'orc.posicoes', acoes: ['consultar', 'excluir'] }])).toBe(true);
    expect(precisaAvisoSemEscopo(false, [{ funcionalidade: 'orc.pacotes', acoes: ['consultar'] }])).toBe(false);
    expect(precisaAvisoSemEscopo(true, [{ funcionalidade: 'orc.pacotes', acoes: ['incluir'] }])).toBe(false);
    expect(AVISO_SEM_ESCOPO).toContain('Gestor de Diretoria');
  });
});
