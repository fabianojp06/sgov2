// Filtros das consultas em árvore do plano de contas e dos centros de custo (US-044 e US-046).
import type { DefinicaoFiltro } from '@/modules/ger';
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
