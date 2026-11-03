import { falha, ok, type Resultado } from '@/shared/kernel';
import { MENSAGENS_ORC } from './mensagens';

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

export type EventoCiclo = 'AVANCAR' | 'ENVIAR' | 'APROVAR' | 'REJEITAR';

const TRANSICOES: Readonly<Record<EventoCiclo, { de: SituacaoExercicio; para: SituacaoExercicio }>> = {
  AVANCAR: { de: 'RASCUNHO', para: 'EM_ELABORACAO' },
  ENVIAR: { de: 'EM_ELABORACAO', para: 'EM_APROVACAO' },
  APROVAR: { de: 'EM_APROVACAO', para: 'OFICIALIZADO' },
  REJEITAR: { de: 'EM_APROVACAO', para: 'EM_ELABORACAO' },
};

// §6.2: Rascunho → Em Elaboração → Em Aprovação → Oficializado; a rejeição volta para Em
// Elaboração. O banco impõe as mesmas transições (trigger orc_ciclo_exercicio).
export function transicionar(de: SituacaoExercicio, evento: EventoCiclo): Resultado<SituacaoExercicio> {
  const t = TRANSICOES[evento];
  if (t.de !== de) return falha([{ campo: '_', mensagem: MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(ROTULO_SITUACAO[de]) }]);
  return ok(t.para);
}

// Ano sugerido no Novo exercício: o seguinte ao maior existente; sem nenhum, o ano seguinte ao atual.
export function anoPadrao(existentes: readonly number[], hoje: Date): number {
  return existentes.length > 0 ? Math.max(...existentes) + 1 : hoje.getUTCFullYear() + 1;
}

// R18: a cópia parte do maior ano menor que o novo, em qualquer situação.
export function exercicioOrigemDaCopia(existentes: readonly number[], novo: number): number | null {
  const anteriores = existentes.filter((a) => a < novo);
  return anteriores.length > 0 ? Math.max(...anteriores) : null;
}
