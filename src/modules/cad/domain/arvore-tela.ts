import type { NoCentroCusto, NoConta } from './estrutura';

// O plano de contas e os centros de custo como nós da grade de consulta (US-044 e US-046; plano do
// P4, Tasks 7b e 8). Pura e serializável: montada no servidor e podada no cliente.

/** Nó da grade com a coluna `situacao` (Ativa/Inativa), que a poda das inativas usa. */
export type NoTela<C extends string> = { id: string; linha: Record<C | 'situacao', string | null>; filhos?: readonly NoTela<C>[] };

export type ColunaConta = 'classificacao' | 'reduzido' | 'descricao' | 'nivel' | 'tipo' | 'situacao';
export type NoContaTela = NoTela<ColunaConta>;

// O reduzido fica ao lado da classificação; os selos marcam o CC de gestão (R17) e o provisório (GAP-CC-001).
export type ColunaCc = 'classificacao' | 'reduzido' | 'descricao' | 'nivel' | 'tipo' | 'selos' | 'situacao';
export type NoCcTela = NoTela<ColunaCc>;
export const SELO_GESTAO = 'Gestão';
export const SELO_PROVISORIO = 'Provisório';

export const SITUACAO_INATIVA = 'Inativa';
export const SITUACAO_INATIVO = 'Inativo';

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

export function paraNoTelaCc(c: NoCentroCusto): NoCcTela {
  return {
    id: c.classificacao,
    linha: {
      classificacao: c.classificacao,
      reduzido: c.codigoReduzido,
      descricao: c.descricao,
      nivel: String(c.nivel),
      tipo: c.tipo === 'SINTETICO' ? 'Sintético' : 'Analítico',
      selos: [c.deGestao ? SELO_GESTAO : null, c.provisorio ? SELO_PROVISORIO : null].filter((x) => x !== null).join(' · ') || null,
      situacao: c.ativo ? 'Ativo' : SITUACAO_INATIVO,
    },
    ...(c.filhos.length > 0 ? { filhos: c.filhos.map(paraNoTelaCc) } : {}),
  };
}

/** Sem os nós inativos (e o que estiver abaixo deles): o padrão da tela. */
export function podarInativas<C extends string>(nos: readonly NoTela<C>[]): NoTela<C>[] {
  return nos
    .filter((n) => n.linha.situacao !== SITUACAO_INATIVA && n.linha.situacao !== SITUACAO_INATIVO)
    .map((n) => (n.filhos ? { ...n, filhos: podarInativas(n.filhos) } : n));
}

/** O que a grade mostra: tudo com "Mostrar inativas"; sem a caixa, só as ativas. */
export const nosVisiveis = <C extends string>(nos: readonly NoTela<C>[], mostrarInativas: boolean): readonly NoTela<C>[] => (mostrarInativas ? nos : podarInativas(nos));

/** Texto da grade vazia: sem nenhuma conta, ou com todas inativas e a caixa desmarcada. */
export const textoVazioContas = (nos: readonly NoContaTela[]): string =>
  nos.length === 0 ? 'Nenhuma conta cadastrada. O plano de contas entra pela importação da planilha.' : 'Nenhuma conta ativa. Marque "Mostrar inativas" para ver as inativas.';

/** Texto da grade vazia dos centros de custo. */
export const textoVazioCc = (nos: readonly NoCcTela[]): string =>
  nos.length === 0
    ? 'Nenhum centro de custo cadastrado. Os centros de custo entram pela importação da planilha.'
    : 'Nenhum centro de custo ativo. Marque "Mostrar inativos" para ver os inativos.';
