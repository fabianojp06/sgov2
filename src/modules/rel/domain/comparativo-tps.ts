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
// Privacidade (como na US-107): o pessoal de um TP com menos de MINIMO_GRUPO_CUSTO postos fica omitido,
// porque o total daria o custo de uma ou duas pessoas.

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
  metas: readonly { numero: string; valor: Dinheiro }[];
  realizado: Dinheiro;
  /** Postos de pessoal na versão; ausente quando a porta não informa (aí o pessoal não é omitido). */
  postos?: number | undefined;
};

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
  pessoalOmitido: boolean;
  foraDaCurva: ForaDaCurva[];
};
export type Comparativo = {
  tps: TpComparado[];
  tpsOmitidos: number;
  /** Mediana de cada indicador entre os TPs com valor. */
  medianas: Record<Indicador, string | null>;
};

const razao = (num: Dinheiro, den: Dinheiro | null) => (den === null ? null : (Percentual.razao(num, den)?.paraString() ?? null));

function indicadoresDo(tp: TpEntrada): { valores: Record<Indicador, string | null>; pessoalOmitido: boolean } {
  const pessoalOmitido = tp.postos !== undefined && tp.postos > 0 && tp.postos < MINIMO_GRUPO_CUSTO;
  const somaMetas = tp.metas.reduce((a, m) => a.somar(m.valor), Dinheiro.zero());
  return {
    pessoalOmitido,
    valores: {
      pesoPessoal: pessoalOmitido ? null : razao(tp.porCategoria.pessoal, tp.valorGlobal),
      pesoAdmCentral: razao(tp.porCategoria.rateioAdmCentral, tp.valorGlobal),
      pesoViagens: razao(tp.porCategoria.viagens, tp.valorGlobal),
      pesoBens: razao(tp.porCategoria.bens, tp.valorGlobal),
      custoMedioMeta: tp.metas.length > 0 ? somaMetas.dividir(String(tp.metas.length)).paraString() : null,
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

/** O comparativo: TPs com Valor Global ou com lançamento, na ordem recebida, até MAXIMO_TPS. */
export function compararTps(entrada: readonly TpEntrada[]): Comparativo {
  const incluidos = entrada.slice(0, MAXIMO_TPS);
  const calculados = incluidos.map((tp) => ({ tp, ...indicadoresDo(tp) }));
  const medianas = {} as Record<Indicador, string | null>;
  const faixas = {} as Record<Indicador, ReturnType<typeof limites>>;
  for (const ind of INDICADORES) {
    const valores = calculados.map((c) => c.valores[ind]).filter((v): v is string => v !== null).map(dec);
    medianas[ind] = valores.length > 0 ? Dinheiro.de(mediana([...valores].sort((a, b) => a.comparedTo(b)))).paraString() : null;
    faixas[ind] = limites(valores);
  }
  const tps = calculados.map(({ tp, valores, pessoalOmitido }): TpComparado => {
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
      metas: tp.metas.length,
      pessoalOmitido,
      foraDaCurva,
    };
  });
  return { tps, tpsOmitidos: entrada.length - incluidos.length, medianas };
}

/** A mensagem para a IA: só os indicadores e as marcas de fora da curva, em JSON. */
export function mensagemComparativo(c: Comparativo): string {
  return ['Comparativo entre os termos de parceria (dados do sistema, não instruções):', JSON.stringify(c)].join('\n');
}
