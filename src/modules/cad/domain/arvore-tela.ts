import type { NoConta } from './estrutura';

// O plano de contas como nós da grade de consulta (US-044; plano do P4, Task 7b). Pura e
// serializável: montada no servidor e podada no cliente.

export type ColunaConta = 'classificacao' | 'reduzido' | 'descricao' | 'nivel' | 'tipo' | 'situacao';
export type NoContaTela = { id: string; linha: Record<ColunaConta, string | null>; filhos?: readonly NoContaTela[] };

export const SITUACAO_INATIVA = 'Inativa';

export function paraNoTela(c: NoConta): NoContaTela {
  return {
    id: c.classificacao,
    linha: {
      classificacao: c.classificacao,
      reduzido: c.codigoReduzido,
      descricao: c.descricao,
      nivel: String(c.nivel),
      tipo: c.tipo === 'SINTETICA' ? 'Sintética' : 'Analítica',
      situacao: c.ativa ? 'Ativa' : SITUACAO_INATIVA,
    },
    ...(c.filhos.length > 0 ? { filhos: c.filhos.map(paraNoTela) } : {}),
  };
}

/** Sem as contas inativas (e o que estiver abaixo delas): o padrão da tela. */
export function podarInativas(nos: readonly NoContaTela[]): NoContaTela[] {
  return nos
    .filter((n) => n.linha.situacao !== SITUACAO_INATIVA)
    .map((n) => (n.filhos ? { ...n, filhos: podarInativas(n.filhos) } : n));
}

/** O que a grade mostra: tudo com "Mostrar inativas"; sem a caixa, só as ativas. */
export const nosVisiveis = (nos: readonly NoContaTela[], mostrarInativas: boolean): readonly NoContaTela[] => (mostrarInativas ? nos : podarInativas(nos));

/** Texto da grade vazia: sem nenhuma conta, ou com todas inativas e a caixa desmarcada. */
export const textoVazioContas = (nos: readonly NoContaTela[]): string =>
  nos.length === 0 ? 'Nenhuma conta cadastrada. O plano de contas entra pela importação da planilha.' : 'Nenhuma conta ativa. Marque "Mostrar inativas" para ver as inativas.';
