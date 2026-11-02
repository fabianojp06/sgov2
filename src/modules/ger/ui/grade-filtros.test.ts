import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GradeArvore } from './grade-arvore';
import { aplicarFiltros, lerFiltrosSalvos, validarValoresFiltro, type DefinicaoFiltro } from './grade-filtros';
import type { NoGrade } from './grade-logica';

// Filtros da Tree Grid (plano do P4, Task 6c, Step 1).
type C = 'conta' | 'reduzido' | 'valor' | 'tipo';
const no = (id: string, conta: string, reduzido: string, valor: string, filhos?: NoGrade<C>[]): NoGrade<C> => ({
  id,
  linha: { conta, reduzido, valor, tipo: filhos ? 'S' : 'A' },
  ...(filhos ? { filhos } : {}),
});
const arvore: NoGrade<C>[] = [
  no('4', 'DESPESAS', '', '1500.00', [
    no('4.1.1.1', 'DESPESAS DE PESSOAL', '', '1500.00', [no('4.1.1.1.001', 'Salários', '900', '1500.00'), no('4.1.1.1.003', 'Férias', '920', '0.00')]),
  ]),
];
const defs: DefinicaoFiltro<C>[] = [
  { tipo: 'texto', id: 'busca', rotulo: 'Buscar', campos: ['conta', 'reduzido'] },
  { tipo: 'selecao', id: 'tipo', rotulo: 'Tipo', campo: 'tipo', opcoes: [{ valor: 'A', rotulo: 'Analítica' }, { valor: 'S', rotulo: 'Sintética' }] },
  { tipo: 'ocultarZerados', id: 'zerados', rotulo: 'Ocultar zerados', campos: ['valor'] },
];
const ids = (ns: readonly NoGrade<C>[]): string[] => ns.flatMap((n) => [n.id, ...ids(n.filhos ?? [])]);

describe('aplicarFiltros', () => {
  it('"salario" (sem acento e caixa) acha "Salários" e abre os ancestrais', () => {
    const r = aplicarFiltros(arvore, defs, { busca: 'salario' });
    expect(ids(r.nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001']);
    expect([...r.abrir].sort()).toEqual(['4', '4.1.1.1']);
  });

  it('busca pelo reduzido "900"', () => {
    expect(ids(aplicarFiltros(arvore, defs, { busca: '900' }).nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001']);
  });

  it('ocultarZerados tira a Férias (0.00) e mantém o resto', () => {
    expect(ids(aplicarFiltros(arvore, defs, { zerados: true }).nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001']);
  });

  it('seleção e combinação de critérios (E)', () => {
    expect(ids(aplicarFiltros(arvore, defs, { tipo: 'A', busca: 'f' }).nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.003']);
  });

  it('sem filtro ativo, a mesma referência', () => {
    expect(aplicarFiltros(arvore, defs, {}).nos).toBe(arvore);
    expect(aplicarFiltros(arvore, defs, { busca: '  ', zerados: false }).nos).toBe(arvore);
  });
});

describe('validarValoresFiltro (RF0003)', () => {
  it.each([
    ['101 caracteres', { busca: 'x'.repeat(101) }],
    ['caractere de controle', { busca: 'a\u0000b' }],
    ['opção inexistente', { tipo: 'Z' }],
    ['booleano trocado', { zerados: 'sim' }],
    ['não é objeto', 'texto'],
  ])('%s → erro', (_caso, v) => {
    expect(validarValoresFiltro(defs, v).ok).toBe(false);
  });

  it('valores válidos; chave desconhecida é descartada', () => {
    expect(validarValoresFiltro(defs, { busca: 'sal', tipo: 'A', zerados: true, outra: 'x' })).toEqual({
      ok: true,
      valor: { busca: 'sal', tipo: 'A', zerados: true },
    });
  });
});

describe('lerFiltrosSalvos', () => {
  const salvo = JSON.stringify({ escopo: 'abc', valores: { busca: 'sal', zerados: true } });
  it('mesmo escopo → valores; escopo diferente, sem escopo ou JSON corrompido → undefined', () => {
    expect(lerFiltrosSalvos(salvo, 'abc')).toEqual({ busca: 'sal', zerados: true });
    expect(lerFiltrosSalvos(salvo, 'outro')).toBeUndefined();
    expect(lerFiltrosSalvos(salvo, undefined)).toBeUndefined();
    expect(lerFiltrosSalvos('{corrompido', 'abc')).toBeUndefined();
    expect(lerFiltrosSalvos(null, 'abc')).toBeUndefined();
  });
});

describe('GradeArvore com filtros (SSR)', () => {
  const colunas = [{ campo: 'conta' as const, titulo: 'Conta', tipo: 'texto' as const }];
  it('mostra os filtros e "Limpar filtros"; sem filtros, nada da barra', () => {
    const com = renderToString(createElement(GradeArvore<C>, { idGrade: 'g', nos: arvore, colunas, filtros: defs }));
    expect(com).toContain('Limpar filtros');
    expect(com).toContain('role="search"');
    const sem = renderToString(createElement(GradeArvore<C>, { idGrade: 'g', nos: arvore, colunas }));
    expect(sem).not.toContain('Limpar filtros');
  });
});
