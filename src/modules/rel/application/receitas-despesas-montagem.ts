import type { NoConta } from '@/modules/cad';
import { Dinheiro } from '@/shared/kernel';
import { totalizarSerie } from '@/shared/totalizer';
import { analiticasDe, colunasDoPeriodo, distribuir, nosDaArvore, RAIZ_DESPESAS, type ColunaDespesas, type LinhaRealizado } from './despesas-tp-montagem';

// Demonstrativo de receitas e despesas sintético do TP (US-096 parte 2; UC05.01), 1ª e 2ª tabelas. A 1ª é o
// cronograma de desembolso: o total do previsto no período e o valor de cada coluna (RN0386, REQ0247). A 2ª, por
// conta, o Previsto, o Realizado e o Saldo Acumulado de cada coluna (REQ0248): "Total AAAA a AAAA" do início ao ano
// anterior e mês a mês no ano atual (REQ0246, RN0302/0303). Saldo da 1ª coluna = previsto − realizado (RN0391);
// das seguintes, (previsto − realizado da coluna) + o saldo da anterior (RN0388/0392). O previsto é o cronograma
// da versão oficializada (RN0389), o realizado é o da carga (RN0390), os dois pela porta do orc (US-085).
// As sintéticas ativas aparecem sempre (REQ0249); as analíticas sem valor, só com "exibir zerados" (RN0383).
// A 3ª tabela (parcelas recebidas e rendimentos, REQ0251/0253/0254) depende das aplicações financeiras (US-088).

export type Prs = { previsto: string; realizado: string; saldo: string };
export type LinhaPrevistoRealizado = { classificacao: string; descricao: string; nivel: number; analitica: boolean; inativa: boolean; valores: Prs[]; total: Prs };
export type Fora = { quantidade: number; valor: string };
export type PrevistoRealizado = {
  colunas: ColunaDespesas[];
  /** 1ª tabela: o cronograma de desembolso (todo o previsto do período, por coluna). */
  cronograma: { valores: string[]; total: string };
  linhas: LinhaPrevistoRealizado[];
  totalGeral: { valores: Prs[]; total: Prs };
  /** Lançamentos em conta que não é analítica de despesa (fora da 2ª tabela). */
  foraDaArvore: { previsto: Fora; realizado: Fora };
};

/** "set/2025 a dez/2026" → "Total 2025 a 2026" (REQ0246); os meses ficam como estão (Jan/27). */
const comTotal = (c: ColunaDespesas): ColunaDespesas => (c.de === c.ate ? c : { ...c, rotulo: `Total ${c.de.slice(0, 4)} a ${c.ate.slice(0, 4)}` });

const somar = (xs: readonly Dinheiro[]) => xs.reduce((a, b) => a.somar(b), Dinheiro.zero());

/** O saldo acumulado coluna a coluna (RN0388, RN0391, RN0392). */
export function saldosAcumulados(previsto: readonly Dinheiro[], realizado: readonly Dinheiro[]): Dinheiro[] {
  let anterior = Dinheiro.zero();
  return previsto.map((p, i) => (anterior = p.subtrair(realizado[i]!).somar(anterior)));
}

function prs(previsto: readonly Dinheiro[], realizado: readonly Dinheiro[]): { valores: Prs[]; total: Prs } {
  const saldos = saldosAcumulados(previsto, realizado);
  const [p, r] = [somar(previsto), somar(realizado)];
  return {
    valores: previsto.map((v, i) => ({ previsto: v.paraString(), realizado: realizado[i]!.paraString(), saldo: saldos[i]!.paraString() })),
    total: { previsto: p.paraString(), realizado: r.paraString(), saldo: p.subtrair(r).paraString() },
  };
}

export function montarPrevistoRealizado(
  arvore: readonly NoConta[],
  realizado: readonly LinhaRealizado[],
  previsto: readonly LinhaRealizado[],
  de: string,
  ate: string,
  opcoes: { exibirZerados: boolean; anoAtual: number },
): PrevistoRealizado {
  const colunas = colunasDoPeriodo(de, ate, opcoes.anoAtual).map(comTotal);
  const { nos, ordem } = nosDaArvore(arvore.filter((n) => n.classificacao === RAIZ_DESPESAS));
  const analiticas = analiticasDe(nos);
  const r = distribuir(realizado, colunas, analiticas);
  const p = distribuir(previsto, colunas, analiticas);
  // O cronograma soma todo o previsto do período, inclusive o que ficou fora da árvore (avisado à parte).
  const cronogramaSerie = colunas.map((c) => somar(previsto.filter((l) => c.de <= l.competencia && l.competencia <= c.ate).map((l) => l.valor)));
  const cronograma = { valores: cronogramaSerie.map((v) => v.paraString()), total: somar(cronogramaSerie).paraString() };
  const foraDaArvore = { previsto: p.foraDaArvore, realizado: r.foraDaArvore };
  const zeros = colunas.map(() => Dinheiro.zero());
  if (colunas.length === 0 || nos.length === 0) return { colunas, cronograma, linhas: [], totalGeral: prs(zeros, zeros), foraDaArvore };

  const tr = totalizarSerie(nos, r.series, colunas.length);
  const tp = totalizarSerie(nos, p.series, colunas.length);
  const visivel = new Map<string, boolean>();
  for (const { no, inativa } of [...ordem].reverse()) {
    const comValor = [...tr.valor(no.classificacao), ...tp.valor(no.classificacao)].some((v) => !v.ehZero());
    const filhosVisiveis = no.filhos.some((f) => visivel.get(f.classificacao));
    const sinteticaAtiva = no.tipo !== 'ANALITICA' && !inativa;
    visivel.set(no.classificacao, comValor || filhosVisiveis || sinteticaAtiva || (opcoes.exibirZerados && !inativa));
  }
  const linhas = ordem
    .filter(({ no }) => visivel.get(no.classificacao))
    .map(({ no, nivel, inativa }) => ({
      classificacao: no.classificacao,
      descricao: no.descricao,
      nivel,
      analitica: no.tipo === 'ANALITICA',
      inativa,
      ...prs(tp.valor(no.classificacao), tr.valor(no.classificacao)),
    }));
  return { colunas, cronograma, linhas, totalGeral: prs(tp.total, tr.total), foraDaArvore };
}
