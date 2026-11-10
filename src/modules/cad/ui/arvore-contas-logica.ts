// Filtros das consultas em árvore do plano de contas e dos centros de custo (US-044 e US-046).
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

/** Link da exportação com o que a tela mostra: formato, "mostrar inativos" e os filtros com valor (US-024). */
export function hrefExportacao(base: string, formato: FormatoArquivo, inativos: boolean, valores: ValoresFiltro): string {
  const q = new URLSearchParams({ formato });
  if (inativos) q.set('inativos', '1');
  for (const [id, v] of Object.entries(valores)) if (typeof v === 'string' && v.trim() !== '') q.set(id, v);
  return `${base}?${q.toString()}`;
}
