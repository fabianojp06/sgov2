// Colunas e filtros das consultas em árvore do plano de contas e dos centros de custo (US-044 e US-046),
// os mesmos na tela (ui/) e na exportação (exportar-estrutura.ts, US-024): uma fonte só, para o arquivo
// sair igual à tela. Sem 'use client' nem servidor: vale nos dois lados.
import type { DefinicaoFiltro, FormatoArquivo, ValoresFiltro } from '@/modules/ger';
import type { ColunaCc, ColunaConta } from '../domain/arvore-tela';

// Busca por código (classificação), reduzido e descrição (US-044).
export const FILTROS_CONTAS: readonly DefinicaoFiltro<ColunaConta>[] = [
  { tipo: 'texto', id: 'busca', rotulo: 'Buscar por classificação, reduzido ou descrição', campos: ['classificacao', 'reduzido', 'descricao'] },
  {
    tipo: 'selecao',
    id: 'tipo',
    rotulo: 'Tipo',
    campo: 'tipo',
    opcoes: [
      { valor: 'Sintética', rotulo: 'Sintética' },
      { valor: 'Analítica', rotulo: 'Analítica' },
    ],
  },
];

// Busca por classificação, reduzido e descrição, como no plano de contas.
export const FILTROS_CC: readonly DefinicaoFiltro<ColunaCc>[] = [
  { tipo: 'texto', id: 'busca', rotulo: 'Buscar por classificação, reduzido ou descrição', campos: ['classificacao', 'reduzido', 'descricao'] },
  {
    tipo: 'selecao',
    id: 'tipo',
    rotulo: 'Tipo',
    campo: 'tipo',
    opcoes: [
      { valor: 'Sintético', rotulo: 'Sintético' },
      { valor: 'Analítico', rotulo: 'Analítico' },
    ],
  },
];

export type ColunaExportada<C extends string> = { campo: C; titulo: string; largura: number };

export const COLUNAS_CONTAS: readonly ColunaExportada<ColunaConta>[] = [
  { campo: 'classificacao', titulo: 'Classificação', largura: 110 },
  { campo: 'reduzido', titulo: 'Reduzido', largura: 70 },
  { campo: 'descricao', titulo: 'Descrição', largura: 320 },
  { campo: 'nivel', titulo: 'Nível', largura: 50 },
  { campo: 'tipo', titulo: 'Tipo', largura: 80 },
  { campo: 'situacao', titulo: 'Situação', largura: 70 },
];

export const COLUNAS_CC: readonly ColunaExportada<ColunaCc>[] = [
  { campo: 'classificacao', titulo: 'Classificação', largura: 100 },
  { campo: 'reduzido', titulo: 'Reduzido', largura: 70 },
  { campo: 'descricao', titulo: 'Descrição', largura: 320 },
  { campo: 'nivel', titulo: 'Nível', largura: 50 },
  { campo: 'tipo', titulo: 'Tipo', largura: 80 },
  { campo: 'selos', titulo: 'Selos', largura: 120 },
  { campo: 'situacao', titulo: 'Situação', largura: 70 },
];

// Parâmetros da rota de exportação que nenhum filtro pode usar como id (sobrescreveriam o formato).
const RESERVADOS = new Set(['formato', 'inativos']);

/**
 * Link da exportação com o que a tela mostra: formato, "mostrar inativos" e os filtros de texto e de
 * seleção com valor (US-024). Filtro booleano ("ocultar zerados") não existe nestas telas e não vai.
 */
export function hrefExportacao(base: string, formato: FormatoArquivo, inativos: boolean, valores: ValoresFiltro): string {
  const q = new URLSearchParams({ formato });
  if (inativos) q.set('inativos', '1');
  for (const [id, v] of Object.entries(valores)) if (!RESERVADOS.has(id) && typeof v === 'string' && v.trim() !== '') q.set(id, v);
  return `${base}?${q.toString()}`;
}
