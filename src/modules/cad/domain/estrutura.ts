// C1 — Estrutura financeira (spec §6.1, §6.1a, D7; plano do P4, Task 2).
//
// R5: a classificação é a chave entre módulos e NUNCA muda. A recarga só atualiza descrição e
// situação; um reduzido que muda de classificação inativa o registro antigo e cria um novo. Por
// isso os consumidores guardam a classificação, nunca o id do banco nem o reduzido.

import type { NaturezaConta } from './parametro-local-conta';

export type Nivel = 1 | 2 | 3 | 4 | 5;
export type TipoConta = 'SINTETICA' | 'ANALITICA';

export type NoConta = {
  /** '4.1.1.1.001', única e imutável (R5). */
  classificacao: string;
  /** Obrigatório e único (entre ativas) nas analíticas; null nas sintéticas. */
  codigoReduzido: string | null;
  /** Sem a marca vedada (GAP-CAD-005). */
  descricao: string;
  /** Analítica ⇔ nível 5. */
  nivel: Nivel;
  tipo: TipoConta;
  ativa: boolean;
  /**
   * Natureza OPEX/CAPEX do parâmetro local da conta analítica (US-045; pedido da frente A na #138, 14/11,
   * para o seletor de bens da US-072). Null ou ausente: a GFIN ainda não definiu (e sintéticas). Opcional
   * só para não quebrar quem monta NoConta à mão; o listarArvoreContas real sempre preenche.
   */
  natureza?: NaturezaConta | null;
  /** Ordenados pela classificação, por segmentos numéricos. */
  filhos: readonly NoConta[];
};

export type TipoCentroCusto = 'SINTETICO' | 'ANALITICO';
export type NaturezaCentroCusto = 'FINALISTICO' | 'APOIO' | 'ADMINISTRATIVO' | 'GESTAO';

export type NoCentroCusto = {
  /** '4.3.2.11', única e imutável (R5); não fixa dígitos por segmento (GAP-CC-002). */
  classificacao: string;
  /** '14.370', único entre ativos. */
  codigoReduzido: string;
  descricao: string;
  /** O analítico pode estar em qualquer nível de 2 a 5. */
  nivel: Nivel;
  tipo: TipoCentroCusto;
  ativo: boolean;
  /** CC de gestão da diretoria ou gerência (R17). */
  deGestao: boolean;
  /** Nula até a definição da GAP-CC-006. */
  natureza: NaturezaCentroCusto | null;
  /** Carga sem aprovação da DIREX (GAP-CC-001). */
  provisorio: boolean;
  filhos: readonly NoCentroCusto[];
};

/**
 * Padrão: só ativos. "Ativo" é efetivo: o nó e todos os ancestrais ativos. Um nó ativo sob um pai
 * inativo fica fora da árvore e do índice; a carga também não grava esse caso (M-n3).
 */
export type OpcoesArvore = { incluirInativos?: boolean };

/** Mesmo formato do NoArvore de @/shared/totalizer (o domain/ não importa o totalizer). */
export type NoIndice = { readonly id: string; readonly paiId: string | null; readonly tipo: 'SINTETICA' | 'ANALITICA' };

export type IndiceEstruturaFinanceira = {
  contaAnaliticaAtiva(classificacao: string): boolean;
  /** Analítica ativa com natureza CAPEX (RN0411, RN0419: Imobilizado e Intangível). Sem natureza definida: false. */
  contaAnaliticaCapex(classificacao: string): boolean;
  centroCustoAnalitico(classificacao: string): boolean;
  /**
   * Analíticas ativas da subárvore, inclusive a raiz se analítica (ex.: '4.1.1.1' para separar as
   * contas de pessoal dos pacotes base zero). Raiz inexistente ou inativa: lista vazia.
   */
  contasAnaliticasSob(classificacaoRaiz: string): readonly string[];
  /**
   * Escopo do Gestor de Diretoria (C25): CCs analíticos ativos da subárvore, inclusive a raiz se
   * analítica. Raiz inexistente ou inativa: lista vazia (nenhum escopo, nunca "tudo").
   */
  centrosCustoAnaliticosSob(classificacaoRaiz: string): readonly string[];
  /** Para o totalizar(): id = classificação; só ativos. */
  nosContas: readonly NoIndice[];
  /** SINTETICO → 'SINTETICA', ANALITICO → 'ANALITICA'; só ativos. */
  nosCentrosCusto: readonly NoIndice[];
};

/**
 * Ordem da classificação por segmentos numéricos: '4.3.2.9' vem antes de '4.3.2.10'. Ordem total:
 * segmento não numérico vai depois dos numéricos, e o empate ('4.01' × '4.1') cai na ordem do texto.
 */
export function compararClassificacao(a: string, b: string): number {
  const sa = a.split('.');
  const sb = b.split('.');
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const na = /^\d+$/.test(sa[i]!) ? Number(sa[i]) : Number.POSITIVE_INFINITY;
    const nb = /^\d+$/.test(sb[i]!) ? Number(sb[i]) : Number.POSITIVE_INFINITY;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  if (sa.length !== sb.length) return sa.length - sb.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Congela a árvore inteira (os exemplos dos falsos são compartilhados entre testes). */
export function congelarArvore<T extends { filhos: readonly T[] }>(nos: readonly T[]): readonly T[] {
  for (const no of nos) {
    congelarArvore(no.filhos);
    Object.freeze(no.filhos);
    Object.freeze(no);
  }
  return Object.freeze(nos);
}

type NoGenerico = { classificacao: string; filhos: readonly NoGenerico[] };

function filtrarOrdenar<T extends NoGenerico>(nos: readonly T[], ativo: (no: T) => boolean): T[] {
  return nos
    .filter(ativo)
    .map((no) => ({ ...no, filhos: filtrarOrdenar(no.filhos as readonly T[], ativo) }))
    .sort((a, b) => compararClassificacao(a.classificacao, b.classificacao));
}

/** Cópia da árvore com os filhos ordenados e, sem `incluirInativos`, só os ativos (e seus descendentes). */
export function prepararArvoreContas(contas: readonly NoConta[], opcoes: OpcoesArvore = {}): NoConta[] {
  return filtrarOrdenar(contas, (c) => opcoes.incluirInativos === true || c.ativa);
}

export function prepararArvoreCentrosCusto(ccs: readonly NoCentroCusto[], opcoes: OpcoesArvore = {}): NoCentroCusto[] {
  return filtrarOrdenar(ccs, (c) => opcoes.incluirInativos === true || c.ativo);
}

type Plano = { analiticas: Set<string>; sob: Map<string, string[]>; nos: NoIndice[] };

function planificar<T extends NoGenerico>(raizes: readonly T[], analitico: (no: T) => boolean): Plano {
  const plano: Plano = { analiticas: new Set(), sob: new Map(), nos: [] };
  const visitar = (no: T, paiId: string | null): string[] => {
    const eh = analitico(no);
    plano.nos.push(Object.freeze({ id: no.classificacao, paiId, tipo: eh ? 'ANALITICA' : 'SINTETICA' }));
    const abaixo = eh ? [no.classificacao] : [];
    if (eh) plano.analiticas.add(no.classificacao);
    for (const filho of no.filhos as readonly T[]) abaixo.push(...visitar(filho, no.classificacao));
    plano.sob.set(no.classificacao, abaixo);
    return abaixo;
  };
  for (const raiz of raizes) visitar(raiz, null);
  return plano;
}

/** Índice em memória das árvores ativas, para os consumidores que validam muitas linhas (US-121). Imutável. */
export function montarIndice(contas: readonly NoConta[], ccs: readonly NoCentroCusto[]): IndiceEstruturaFinanceira {
  const pc = planificar(prepararArvoreContas(contas), (c) => c.tipo === 'ANALITICA');
  const cc = planificar(prepararArvoreCentrosCusto(ccs), (c) => c.tipo === 'ANALITICO');
  const capex = new Set<string>();
  const marcarCapex = (nos: readonly NoConta[]) => {
    for (const no of nos) {
      if (no.tipo === 'ANALITICA' && no.ativa && no.natureza === 'CAPEX') capex.add(no.classificacao);
      marcarCapex(no.filhos);
    }
  };
  marcarCapex(prepararArvoreContas(contas));
  return Object.freeze({
    contaAnaliticaAtiva: (classificacao: string) => pc.analiticas.has(classificacao),
    contaAnaliticaCapex: (classificacao: string) => capex.has(classificacao),
    centroCustoAnalitico: (classificacao: string) => cc.analiticas.has(classificacao),
    contasAnaliticasSob: (raiz: string) => Object.freeze([...(pc.sob.get(raiz) ?? [])]),
    centrosCustoAnaliticosSob: (raiz: string) => Object.freeze([...(cc.sob.get(raiz) ?? [])]),
    nosContas: Object.freeze(pc.nos),
    nosCentrosCusto: Object.freeze(cc.nos),
  });
}
