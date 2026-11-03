// Exercício do orçamento da Adm. Central e o ciclo de vida da §6.2 (a Task 3 completa as transições).
export type SituacaoExercicio = 'RASCUNHO' | 'EM_ELABORACAO' | 'EM_APROVACAO' | 'OFICIALIZADO';

export const ROTULO_SITUACAO: Readonly<Record<SituacaoExercicio, string>> = {
  RASCUNHO: 'Rascunho',
  EM_ELABORACAO: 'Em Elaboração',
  EM_APROVACAO: 'Em Aprovação',
  OFICIALIZADO: 'Oficializado',
};

// Edição só em Rascunho e Em Elaboração (RN_ALT_002); o banco também recusa (trigger da Task 1).
export function editavel(s: SituacaoExercicio): boolean {
  return s === 'RASCUNHO' || s === 'EM_ELABORACAO';
}
