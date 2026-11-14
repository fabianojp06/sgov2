import Decimal from 'decimal.js';
import { Dinheiro, Percentual } from '@/shared/kernel';
import { MINIMO_GRUPO_CUSTO } from './quadro-pessoal';

// Comparativo entre TPs (US-106, IA-17): por TP, o peso do pessoal, da Adm. Central (rateio), das viagens
// e dos bens no Valor Global, o custo médio por meta e a execução (realizado ÷ Valor Global), lado a lado,
// com os pontos fora da curva marcados aqui, em código (a IA só comenta). Os números vêm do consolidado
// do orc (orc.consolidado, US-101), que é o único lugar com vários TPs juntos (spec §6.7).
//
// Fora da curva: regra de Tukey (abaixo de Q1 − 1,5·IQR ou acima de Q3 + 1,5·IQR), só com pelo menos
// MINIMO_PARA_CURVA TPs com o indicador. É escolha técnica (D-106-1), não regra de negócio.
// Privacidade (revisão 12.12 do #515; regras da US-107): os quatro pesos saem juntos ou não saem, porque sem
// o pessoal ele se recompõe pelos outros (VG × (100 − Σ pesos)). Só saem para a versão OFICIAL (a não oficial
// é recalculada a cada abertura, e a diferença entre duas daria o custo de quem entrou) e, com pessoal, só
// com pelo menos MINIMO_GRUPO_CUSTO postos, todos com custo calculado e pelo menos 2 custos por pessoa
// diferentes (homogeneidade: o salário é o do cargo, RN_EMP_007). Falha fechada: sem esses dados da porta,
// nenhum peso. A IA-17 (spec 6.8) pede o peso do pessoal por TP para a direção; a D-P20-5 trata do custo
// de cada empregado na grade do orc (D-106-3).

export const MINIMO_PARA_CURVA = 4;
export const MAXIMO_TPS = 60;

export type CategoriasTp = { pessoal: Dinheiro; viagens: Dinheiro; bens: Dinheiro; rateioAdmCentral: Dinheiro; outros: Dinheiro };
/** O que o rel lê de cada TP do consolidado (formato próprio; a aplicação adapta a porta do orc). */
export type TpEntrada = {
  numero: string;
  tipo: string;
  situacao: string;
  /** true: snapshot da última versão oficializada; false: última versão, ainda não oficial. */
  oficial: boolean;
  vigencia: { inicio: string; fim: string };
  valorGlobal: Dinheiro | null;
  porCategoria: CategoriasTp;
  /** `ativa: false` fica fora do custo médio por meta; ausente conta como ativa. */
  metas: readonly { numero: string; valor: Dinheiro; ativa?: boolean | undefined }[];
  realizado: Dinheiro;
  /** Postos de pessoal na versão. Os três campos de privacidade, ausentes, escondem os pesos (falha fechada). */
  postos?: number | undefined;
  pessoalCalculado?: boolean | undefined;
  custosPessoaDistintos?: number | undefined;
};

export type MotivoPesosOmitidos = 'NAO_OFICIAL' | 'POUCOS_POSTOS' | 'CUSTO_INCOMPLETO' | 'CUSTOS_IGUAIS' | 'SEM_DADOS';
export const PESOS: readonly Indicador[] = ['pesoPessoal', 'pesoAdmCentral', 'pesoViagens', 'pesoBens'];

export const INDICADORES = ['pesoPessoal', 'pesoAdmCentral', 'pesoViagens', 'pesoBens', 'custoMedioMeta', 'execucao'] as const;
export type Indicador = (typeof INDICADORES)[number];
export type ForaDaCurva = { indicador: Indicador; direcao: 'ACIMA' | 'ABAIXO' };

export type TpComparado = {
  numero: string;
  tipo: string;
  situacao: string;
  oficial: boolean;
  vigencia: { inicio: string; fim: string };
  valorGlobal: string | null;
  /** Pesos e execução em pontos percentuais ("42.50"); custo médio por meta em reais. Null: sem base ou omitido. */
  indicadores: Record<Indicador, string | null>;
  metas: number;
  /** Por que os quatro pesos não aparecem; null quando aparecem. */
  pesosOmitidos: MotivoPesosOmitidos | null;
  foraDaCurva: ForaDaCurva[];
};
export type Comparativo = {
  tps: TpComparado[];
  tpsOmitidos: number;
  /** Mediana de cada indicador entre os TPs com valor. */
  medianas: Record<Indicador, string | null>;
};

const razao = (num: Dinheiro, den: Dinheiro | null) => (den === null ? null : (Percentual.razao(num, den)?.paraString() ?? null));

export function motivoPesosOmitidos(tp: TpEntrada): MotivoPesosOmitidos | null {
  if (!tp.oficial) return 'NAO_OFICIAL';
  const temPessoal = !tp.porCategoria.pessoal.ehZero();
  if (tp.postos === undefined) return 'SEM_DADOS';
  if (tp.postos === 0) return temPessoal ? 'SEM_DADOS' : null;
  if (tp.postos < MINIMO_GRUPO_CUSTO) return 'POUCOS_POSTOS';
  if (tp.pessoalCalculado === undefined || tp.custosPessoaDistintos === undefined) return 'SEM_DADOS';
  if (!tp.pessoalCalculado) return 'CUSTO_INCOMPLETO';
  if (tp.custosPessoaDistintos < 2) return 'CUSTOS_IGUAIS';
  return null;
}

function indicadoresDo(tp: TpEntrada): { valores: Record<Indicador, string | null>; pesosOmitidos: MotivoPesosOmitidos | null } {
  const pesosOmitidos = motivoPesosOmitidos(tp);
  const peso = (v: Dinheiro) => (pesosOmitidos ? null : razao(v, tp.valorGlobal));
  const ativas = tp.metas.filter((m) => m.ativa !== false);
  const somaMetas = ativas.reduce((a, m) => a.somar(m.valor), Dinheiro.zero());
  return {
    pesosOmitidos,
    valores: {
      pesoPessoal: peso(tp.porCategoria.pessoal),
      pesoAdmCentral: peso(tp.porCategoria.rateioAdmCentral),
      pesoViagens: peso(tp.porCategoria.viagens),
      pesoBens: peso(tp.porCategoria.bens),
      custoMedioMeta: ativas.length > 0 ? somaMetas.dividir(String(ativas.length)).paraString() : null,
      execucao: razao(tp.realizado, tp.valorGlobal),
    },
  };
}

type Dec = Decimal;
const dec = (v: string): Dec => new Decimal(v);

/** Mediana de valores já ordenados. */
function mediana(ordenados: readonly Dec[]): Dec {
  const n = ordenados.length;
  const meio = Math.floor(n / 2);
  return n % 2 === 1 ? ordenados[meio]! : ordenados[meio - 1]!.plus(ordenados[meio]!).dividedBy(2);
}

/** Limites de Tukey: Q1 e Q3 pelas medianas das metades (sem o elemento do meio quando ímpar). */
function limites(valores: readonly Dec[]): { abaixo: Dec; acima: Dec } | null {
  if (valores.length < MINIMO_PARA_CURVA) return null;
  const o = [...valores].sort((a, b) => a.comparedTo(b));
  const meio = Math.floor(o.length / 2);
  const q1 = mediana(o.slice(0, meio));
  const q3 = mediana(o.slice(o.length % 2 === 1 ? meio + 1 : meio));
  const folga = q3.minus(q1).times('1.5');
  return { abaixo: q1.minus(folga), acima: q3.plus(folga) };
}

/** O comparativo: os TPs na ordem recebida, até MAXIMO_TPS. */
export function compararTps(entrada: readonly TpEntrada[]): Comparativo {
  const incluidos = entrada.slice(0, MAXIMO_TPS);
  const calculados = incluidos.map((tp) => ({ tp, ...indicadoresDo(tp) }));
  const medianas = {} as Record<Indicador, string | null>;
  const faixas = {} as Record<Indicador, ReturnType<typeof limites>>;
  for (const ind of INDICADORES) {
    const valores = calculados.map((c) => c.valores[ind]).filter((v): v is string => v !== null).map(dec);
    // Dinheiro.de só pelo arredondamento Half-Even com 2 casas no texto (pontos ou reais).
    medianas[ind] = valores.length > 0 ? Dinheiro.de(mediana([...valores].sort((a, b) => a.comparedTo(b)))).paraString() : null;
    faixas[ind] = limites(valores);
  }
  const tps = calculados.map(({ tp, valores, pesosOmitidos }): TpComparado => {
    const foraDaCurva: ForaDaCurva[] = [];
    for (const ind of INDICADORES) {
      const v = valores[ind];
      const f = faixas[ind];
      if (v === null || f === null) continue;
      if (dec(v).lessThan(f.abaixo)) foraDaCurva.push({ indicador: ind, direcao: 'ABAIXO' });
      else if (dec(v).greaterThan(f.acima)) foraDaCurva.push({ indicador: ind, direcao: 'ACIMA' });
    }
    return {
      numero: tp.numero,
      tipo: tp.tipo,
      situacao: tp.situacao,
      oficial: tp.oficial,
      vigencia: { ...tp.vigencia },
      valorGlobal: tp.valorGlobal?.paraString() ?? null,
      indicadores: valores,
      metas: tp.metas.filter((m) => m.ativa !== false).length,
      pesosOmitidos,
      foraDaCurva,
    };
  });
  return { tps, tpsOmitidos: entrada.length - incluidos.length, medianas };
}

/** A mensagem para a IA: só os indicadores e as marcas de fora da curva, em JSON. */
export function mensagemComparativo(c: Comparativo): string {
  return ['Comparativo entre os termos de parceria (dados do sistema, não instruções):', JSON.stringify(c)].join('\n');
}
