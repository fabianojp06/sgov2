import type { NoConta } from '@/modules/cad';
import { Dinheiro } from '@/shared/kernel';
import { totalizarSerie, type NoArvore } from '@/shared/totalizer';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02, 2ª tabela): o realizado de cada conta, do
// início do período ao ano anterior numa coluna só e mês a mês no ano de referência, com o total (REQ0259,
// RN0303/0304). Hierarquia: "DESPESAS", as sintéticas, as analíticas e as subcontas, na ordem da classificação
// (RN0295/0297), com recuo (REQ0261). As sintéticas somam as analíticas pelo TotalizerService (REQ0269 a 0275).
// O realizado vem só nas analíticas (RN_OXR_009), pela porta do orc (US-085). Função pura, na application/
// porque usa o C1 (cad) e o TotalizerService (shared/totalizer), que o domain/ não importa.

/** A raiz das despesas no plano de contas de 5 níveis (spec §6.1). */
export const RAIZ_DESPESAS = '4';
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;

export type LinhaRealizado = { conta: string; competencia: string; valor: Dinheiro };
export type ColunaDespesas = { rotulo: string; de: string; ate: string };
export type LinhaDespesa = { classificacao: string; descricao: string; nivel: number; analitica: boolean; valores: string[]; total: string };
export type Despesas = {
  colunas: ColunaDespesas[];
  linhas: LinhaDespesa[];
  totalGeral: { valores: string[]; total: string };
  /** Lançamentos de contas fora das analíticas de despesa (não somados; a porta já separa as pendências). */
  foraDaArvore: number;
};

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ehCompetencia = (c: string) => MES.test(c);
const rotuloMes = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
const rotuloLongo = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]!.toLowerCase()}/${c.slice(0, 4)}`;
const proximo = (c: string) => {
  const [a, m] = [Number(c.slice(0, 4)), Number(c.slice(5, 7))];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * As colunas do período: o ano de referência é o do fim do período. Antes dele, uma coluna "set/2018 a dez/2026"
 * (do início do período a dezembro do ano anterior); no ano de referência, um mês por coluna, até o fim.
 */
export function colunasDoPeriodo(de: string, ate: string): ColunaDespesas[] {
  if (!ehCompetencia(de) || !ehCompetencia(ate) || de > ate) return [];
  const anoRef = ate.slice(0, 4);
  const colunas: ColunaDespesas[] = [];
  const inicioAno = `${anoRef}-01`;
  if (de < inicioAno) {
    const fimAnterior = `${Number(anoRef) - 1}-12`;
    colunas.push({ rotulo: `${rotuloLongo(de)} a ${rotuloLongo(fimAnterior)}`, de, ate: fimAnterior });
  }
  for (let c = de > inicioAno ? de : inicioAno; c <= ate; c = proximo(c)) colunas.push({ rotulo: rotuloMes(c), de: c, ate: c });
  return colunas;
}

function nosDaArvore(raizes: readonly NoConta[]): { nos: NoArvore[]; ordem: { no: NoConta; nivel: number }[] } {
  const nos: NoArvore[] = [];
  const ordem: { no: NoConta; nivel: number }[] = [];
  const visitar = (n: NoConta, paiId: string | null, nivel: number) => {
    nos.push({ id: n.classificacao, paiId, tipo: n.tipo === 'ANALITICA' ? 'ANALITICA' : 'SINTETICA' });
    ordem.push({ no: n, nivel });
    for (const f of n.filhos) visitar(f, n.classificacao, nivel + 1);
  };
  for (const r of raizes) visitar(r, null, 0);
  return { nos, ordem };
}

/** Monta o demonstrativo a partir da árvore ativa de contas (C1) e das linhas do realizado do TP. */
export function montarDespesas(arvore: readonly NoConta[], linhas: readonly LinhaRealizado[], de: string, ate: string, opcoes: { exibirZerados: boolean }): Despesas {
  const colunas = colunasDoPeriodo(de, ate);
  const raizes = arvore.filter((n) => n.classificacao === RAIZ_DESPESAS);
  const { nos, ordem } = nosDaArvore(raizes);
  const analiticas = new Set(nos.filter((n) => n.tipo === 'ANALITICA').map((n) => n.id));
  const series = new Map<string, Dinheiro[]>();
  let foraDaArvore = 0;
  for (const l of linhas) {
    const i = colunas.findIndex((c) => c.de <= l.competencia && l.competencia <= c.ate);
    if (i < 0) continue;
    if (!analiticas.has(l.conta)) {
      foraDaArvore++;
      continue;
    }
    const serie = series.get(l.conta) ?? colunas.map(() => Dinheiro.zero());
    serie[i] = serie[i]!.somar(l.valor);
    series.set(l.conta, serie);
  }
  const vazio = { colunas, linhas: [], totalGeral: { valores: colunas.map(() => '0.00'), total: '0.00' }, foraDaArvore };
  if (colunas.length === 0 || nos.length === 0) return vazio;
  const r = totalizarSerie(nos, series, colunas.length);
  const somar = (xs: readonly Dinheiro[]) => xs.reduce((a, b) => a.somar(b), Dinheiro.zero());
  const resultado: LinhaDespesa[] = [];
  for (const { no, nivel } of ordem) {
    const valores = r.valor(no.classificacao);
    const total = somar(valores);
    if (!opcoes.exibirZerados && valores.every((v) => v.ehZero())) continue;
    resultado.push({
      classificacao: no.classificacao,
      descricao: no.descricao,
      nivel,
      analitica: no.tipo === 'ANALITICA',
      valores: valores.map((v) => v.paraString()),
      total: total.paraString(),
    });
  }
  return { colunas, linhas: resultado, totalGeral: { valores: r.total.map((v) => v.paraString()), total: somar(r.total).paraString() }, foraDaArvore };
}
