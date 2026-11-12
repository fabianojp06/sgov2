import type { IndiceEstruturaFinanceira, NoCentroCusto, NoConta, PremissasExercicio } from '@/modules/cad/servidor';
import { contasVetadasEmPacote } from './contas-vetadas';

// As listas do formulário do pacote (D-P11-3): contas analíticas ativas sem as vetadas e CCs analíticos
// ativos. Sem autorização nem escopo: opcoesPacote filtra os CCs pelo escopo de quem pede, e a avaliação
// da sugestão de conta no worker (US-062) usa todos (escopo TOTAL, como a GFIN).

export type OpcaoEstrutura = { classificacao: string; descricao: string };

// Analíticos ativos da árvore, em ordem (a árvore já vem ordenada pela classificação).
function analiticos<T extends { classificacao: string; descricao: string; filhos: readonly T[] }>(nos: readonly T[], ehAnalitico: (n: T) => boolean): OpcaoEstrutura[] {
  return nos.flatMap((n) => [...(ehAnalitico(n) ? [{ classificacao: n.classificacao, descricao: n.descricao }] : []), ...analiticos(n.filhos, ehAnalitico)]);
}

export function listasPacote(
  indice: IndiceEstruturaFinanceira,
  arvores: { ccs: readonly NoCentroCusto[]; contas: readonly NoConta[] },
  premissas: PremissasExercicio | null,
): { ccs: OpcaoEstrutura[]; contas: OpcaoEstrutura[] } {
  const vetadas = contasVetadasEmPacote(indice, premissas);
  return {
    ccs: analiticos<NoCentroCusto>(arvores.ccs, (n) => n.tipo === 'ANALITICO' && indice.centroCustoAnalitico(n.classificacao)),
    contas: analiticos<NoConta>(arvores.contas, (n) => n.tipo === 'ANALITICA' && indice.contaAnaliticaAtiva(n.classificacao)).filter((c) => !vetadas.has(c.classificacao)),
  };
}
