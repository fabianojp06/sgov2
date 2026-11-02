import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GradeArvore } from './grade-arvore';
import { aplicarFiltros, chaveFiltros, lerFiltrosSalvos, restaurarFiltros, validarValoresFiltro, type DefinicaoFiltro } from './grade-filtros';
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

  it('ocultarZerados tira a Férias (0.00) e mantém o resto, sem abrir a árvore (só a busca abre)', () => {
    const r = aplicarFiltros(arvore, defs, { zerados: true });
    expect(ids(r.nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001']);
    expect(r.abrir.size).toBe(0);
    expect(aplicarFiltros(arvore, defs, { tipo: 'A' }).abrir.size).toBe(0);
  });

  it('seleção e combinação de critérios (E)', () => {
    expect(ids(aplicarFiltros(arvore, defs, { tipo: 'A', busca: 'f' }).nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.003']);
  });

  it('M5: o sintético que casa pelo texto leva os filhos, sem abrir a si mesmo', () => {
    const r = aplicarFiltros(arvore, defs, { busca: 'pessoal' });
    expect(ids(r.nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001', '4.1.1.1.003']);
    expect([...r.abrir]).toEqual(['4']);
  });

  it('M5: a subárvore herdada ainda passa pelos outros critérios, mesmo com o pai reprovado neles', () => {
    expect(ids(aplicarFiltros(arvore, defs, { busca: 'pessoal', zerados: true }).nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001']);
    // O pai é sintético (reprova no tipo A), mas casou pelo texto: as analíticas abaixo aparecem.
    expect(ids(aplicarFiltros(arvore, defs, { busca: 'pessoal', tipo: 'A' }).nos)).toEqual(['4', '4.1.1.1', '4.1.1.1.001', '4.1.1.1.003']);
    // Buscar a raiz não abre a árvore inteira: só o que casa pelo próprio texto abre os ancestrais.
    expect([...aplicarFiltros(arvore, defs, { busca: 'despesas' }).abrir]).toEqual(['4']);
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

  it('tab e quebra de linha (texto colado) viram espaço; outro controle tem mensagem própria', () => {
    expect(validarValoresFiltro(defs, { busca: 'Salários\t' })).toEqual({ ok: true, valor: { busca: 'Salários ' } });
    const r = validarValoresFiltro(defs, { busca: 'a\u0007b' });
    expect(r.ok === false && r.erros[0]?.mensagem).toBe('O filtro "Buscar" tem um caractere inválido.');
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

describe('restaurarFiltros', () => {
  const armazenamento = (conteudo: Record<string, string>) => {
    const lidas: string[] = [];
    return { lidas, getItem: (k: string) => (lidas.push(k), conteudo[k] ?? null) };
  };

  it('sem escopoSessao, o storage nem é lido', () => {
    const s = armazenamento({ [chaveFiltros('g')]: JSON.stringify({ escopo: 'abc', valores: { busca: 'x' } }) });
    expect(restaurarFiltros(s, 'g', undefined, defs)).toBeUndefined();
    expect(s.lidas).toEqual([]);
  });

  it('mesmo escopo restaura; valor salvo que não passa nas definições atuais é ignorado', () => {
    const ok = armazenamento({ [chaveFiltros('g')]: JSON.stringify({ escopo: 'abc', valores: { busca: 'sal', tipo: 'A' } }) });
    expect(restaurarFiltros(ok, 'g', 'abc', defs)).toEqual({ busca: 'sal', tipo: 'A' });
    const invalido = armazenamento({ [chaveFiltros('g')]: JSON.stringify({ escopo: 'abc', valores: { tipo: 'Z' } }) });
    expect(restaurarFiltros(invalido, 'g', 'abc', defs)).toBeUndefined();
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
