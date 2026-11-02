// Filtros da consulta do plano de contas (US-044; plano do P4, Task 7b).
import type { DefinicaoFiltro } from '@/modules/ger';
import type { ColunaConta } from '../domain/arvore-tela';

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
