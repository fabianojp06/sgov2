import { describe, expect, it } from 'vitest';
import { ehAnalitica, montarArvoreFuncional, validarNovaUnidade, type UnidadeLida } from './estrutura-funcional';

const sup = (tipo: 'DIRETORIA' | 'GERENCIA' | 'SETOR', ativa = true) => ({ tipo, ativa });

describe('validarNovaUnidade (US-048, REQ_EST_002)', () => {
  it.each([
    ['DIRETORIA no topo', 'DIRETORIA', null],
    ['GERENCIA no topo', 'GERENCIA', null],
    ['GERENCIA sob Diretoria', 'GERENCIA', sup('DIRETORIA')],
    ['ASSESSORIA sob Diretoria', 'ASSESSORIA', sup('DIRETORIA')],
    ['COORDENADORIA sob Gerência', 'COORDENADORIA', sup('GERENCIA')],
    ['SETOR sob Gerência', 'SETOR', sup('GERENCIA')],
  ])('aceita %s', (_, tipo, superior) => {
    expect(validarNovaUnidade({ nome: ' Unidade ', tipo, superior }).ok).toBe(true);
  });

  it.each([
    ['E1: Coordenadoria sob Diretoria', 'COORDENADORIA', sup('DIRETORIA'), /sob uma Gerência/],
    ['Setor no topo', 'SETOR', null, /sob uma Gerência/],
    ['Assessoria sob Gerência', 'ASSESSORIA', sup('GERENCIA'), /sob uma Diretoria/],
    ['Diretoria sob Diretoria', 'DIRETORIA', sup('DIRETORIA'), /no topo/],
    ['Gerência sob Gerência', 'GERENCIA', sup('GERENCIA'), /topo ou sob uma Diretoria/],
    ['qualquer coisa sob analítica', 'SETOR', sup('SETOR'), /sob uma Gerência/],
  ])('recusa %s', (_, tipo, superior, mensagem) => {
    expect(validarNovaUnidade({ nome: 'X', tipo, superior })).toMatchObject({ ok: false, erros: [{ campo: 'superiorId', mensagem: expect.stringMatching(mensagem) }] });
  });

  it('superior inativo, nome vazio ou longo e tipo desconhecido', () => {
    expect(validarNovaUnidade({ nome: 'X', tipo: 'SETOR', superior: sup('GERENCIA', false) })).toMatchObject({ ok: false, erros: [{ campo: 'superiorId' }] });
    expect(validarNovaUnidade({ nome: '  ', tipo: 'DIRETORIA', superior: null })).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    expect(validarNovaUnidade({ nome: 'x'.repeat(121), tipo: 'DIRETORIA', superior: null })).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    expect(validarNovaUnidade({ nome: 'X', tipo: 'NUCLEO', superior: null })).toMatchObject({ ok: false, erros: [{ campo: 'tipo' }] });
  });

  it('ehAnalitica', () => {
    expect(['DIRETORIA', 'GERENCIA', 'ASSESSORIA', 'COORDENADORIA', 'SETOR'].map((t) => ehAnalitica(t as never))).toEqual([false, false, true, true, true]);
  });
});

describe('montarArvoreFuncional', () => {
  const u = (id: string, nome: string, tipo: UnidadeLida['tipo'], superiorId: string | null): UnidadeLida => ({ id, nome, tipo, superiorId, ativa: true, versao: 1 });

  it('filhos em ordem de nome; superior fora da lista vira raiz', () => {
    const arvore = montarArvoreFuncional([
      u('d', 'Diretoria Técnica', 'DIRETORIA', null),
      u('g2', 'Gerência B', 'GERENCIA', 'd'),
      u('g1', 'Gerência A', 'GERENCIA', 'd'),
      u('s', 'Setor de Compras', 'SETOR', 'g1'),
      u('o', 'Órfã', 'GERENCIA', 'inexistente'),
    ]);
    expect(arvore.map((n) => n.nome)).toEqual(['Diretoria Técnica', 'Órfã']);
    expect(arvore[0]!.filhos.map((n) => n.nome)).toEqual(['Gerência A', 'Gerência B']);
    expect(arvore[0]!.filhos[0]!.filhos.map((n) => n.id)).toEqual(['s']);
  });
});
