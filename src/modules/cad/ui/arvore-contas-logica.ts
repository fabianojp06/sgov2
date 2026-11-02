// Lógica pura da consulta do plano de contas (US-044; plano do P4, Task 7b), sem React.
import type { DefinicaoFiltro } from '@/modules/ger';

export type ColunaConta = 'classificacao' | 'reduzido' | 'descricao' | 'nivel' | 'tipo' | 'situacao';
/** Nó da GradeArvore montado no servidor (serializável para o componente cliente). */
export type NoContaTela = { id: string; linha: Record<ColunaConta, string | null>; filhos?: readonly NoContaTela[] };

export const SITUACAO_INATIVA = 'Inativa';

/** Sem as contas inativas (e o que estiver abaixo delas): o padrão da tela. */
export function podarInativas(nos: readonly NoContaTela[]): NoContaTela[] {
  return nos
    .filter((n) => n.linha.situacao !== SITUACAO_INATIVA)
    .map((n) => (n.filhos ? { ...n, filhos: podarInativas(n.filhos) } : n));
}

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
