// Contas dos relatórios (US-097; decisão do PO no #119): a GFIN marca, no plano de contas, quais sintéticas
// reúnem as despesas de viagens e diárias (UC05.03, REQ0279/0280) e quais são o Imobilizado/Intangível (UC05.04,
// RN0411). O código da conta muda entre planos; por isso a marcação, e não o nome. Guardadas no parametro_sistema,
// pela classificação (que nunca muda, R5), separadas por vírgula e em ordem.

export const PAPEIS_CONTA_RELATORIO = {
  viagens: {
    chave: 'relatorio.sinteticas_viagens',
    rotulo: 'Viagens e diárias',
    ajuda: 'As analíticas abaixo destas sintéticas formam o Demonstrativo analítico de despesas com viagens.',
  },
  imobilizado: {
    chave: 'relatorio.sinteticas_imobilizado',
    rotulo: 'Imobilizado/Intangível',
    ajuda: 'As analíticas abaixo destas sintéticas formam o Demonstrativo de aquisições.',
  },
} as const;

export type PapelContaRelatorio = keyof typeof PAPEIS_CONTA_RELATORIO;
export const PAPEIS = Object.keys(PAPEIS_CONTA_RELATORIO) as PapelContaRelatorio[];
export const ehPapel = (p: unknown): p is PapelContaRelatorio => typeof p === 'string' && (PAPEIS as string[]).includes(p);

/** "4.1.2,4.3" → ["4.1.2", "4.3"] (vazio → []). */
export const lerClassificacoes = (valor: string) =>
  valor
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

/** Sem repetição e em ordem de classificação (a mesma escolha grava sempre o mesmo texto). */
export const gravarClassificacoes = (classificacoes: readonly string[]) =>
  [...new Set(classificacoes.map((c) => c.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).join(',');
