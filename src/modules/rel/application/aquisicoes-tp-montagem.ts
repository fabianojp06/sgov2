import type { NoConta } from '@/modules/cad';
import { Dinheiro } from '@/shared/kernel';
import { colunasDoPeriodo, ehCompetencia, nosDaArvore, podarPorTexto, subarvores, type ColunaDespesas, type LinhaRealizado } from './despesas-tp-montagem';

// Demonstrativo de aquisições do TP (US-097 parte 2; UC05.04). As contas são as analíticas abaixo das sintéticas que a
// GFIN marcou como Imobilizado/Intangível (RN0411, REQ0296; decisão do PO no #119). Abaixo de cada conta, os bens da
// versão oficializada (o cadastro de bens da proposta, RN0414) com data, quantidade, valor unitário e total (REQ0291);
// na coluna do mês da data, quantidade × valor unitário (RN0412), somados na conta (RN0415) e no período (RN0413/0416).
// Ao lado, o realizado da conta no período (REQ0292, a execução). As colunas são as dos demonstrativos do TP. Pura.

/** Um bem da versão oficializada, como a porta do orc entrega (`bensDaVersaoOficial`, #544). */
export type BemDoTp = { conta: string; descricao: string; data: string; quantidade: number; valorUnitario: Dinheiro; metaNumero: string | null };

export type ItemAquisicao = { descricao: string; data: string; quantidade: number; valorUnitario: string; valorTotal: string; coluna: number };
export type ContaAquisicao = {
  classificacao: string;
  descricao: string;
  inativa: boolean;
  /** O previsto (os bens) por coluna e no período. */
  valores: string[];
  total: string;
  /** O realizado da conta no período; nulo com o filtro de descrição (o realizado não se divide por bem). */
  realizado: string | null;
  itens: ItemAquisicao[];
};
export type Aquisicoes = {
  colunas: ColunaDespesas[];
  contas: ContaAquisicao[];
  totalGeral: { valores: string[]; total: string; realizado: string | null };
  /** Bens do período em conta que não é analítica abaixo das sintéticas do Imobilizado (não somados); respeita os filtros. */
  foraDasContas: { quantidade: number; valor: string };
};

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function montarAquisicoes(
  arvore: readonly NoConta[],
  raizes: readonly string[],
  bens: readonly BemDoTp[],
  realizado: readonly LinhaRealizado[],
  de: string,
  ate: string,
  opcoes: { anoAtual: number; conta: string; descricao: string; exibirZerados: boolean },
): Aquisicoes {
  const colunas = colunasDoPeriodo(de, ate, opcoes.anoAtual);
  const zeros = () => colunas.map(() => Dinheiro.zero());
  const { ordem } = nosDaArvore(subarvores(podarPorTexto(arvore, opcoes.conta), raizes));
  const analiticas = ordem.filter((o) => o.no.tipo === 'ANALITICA');
  const daConta = new Set(analiticas.map((o) => o.no.classificacao));
  // As contas abaixo das sintéticas, sem o filtro de conta: o bem de outra conta do Imobilizado não é "fora".
  const todas = new Set(nosDaArvore(subarvores(arvore, raizes)).nos.filter((n) => n.tipo === 'ANALITICA').map((n) => n.id));
  const t = semAcento(opcoes.descricao);
  const coluna = (competencia: string) => colunas.findIndex((c) => c.de <= competencia && competencia <= c.ate);

  let fora = { quantidade: 0, valor: Dinheiro.zero() };
  const itensPorConta = new Map<string, { item: ItemAquisicao; total: Dinheiro }[]>();
  for (const b of bens) {
    const competencia = b.data.slice(0, 7);
    const i = ehCompetencia(competencia) ? coluna(competencia) : -1;
    if (i < 0) continue;
    const total = b.valorUnitario.multiplicar(String(b.quantidade));
    if (t && !semAcento(b.descricao).includes(t)) continue;
    if (!todas.has(b.conta)) {
      // Com o filtro de conta, o aviso só conta os bens que o filtro pegaria (revisão 12.12).
      if (!opcoes.conta.trim() || b.conta === opcoes.conta.trim() || b.conta.startsWith(`${opcoes.conta.trim()}.`)) fora = { quantidade: fora.quantidade + 1, valor: fora.valor.somar(total) };
      continue;
    }
    if (!daConta.has(b.conta)) continue;
    const item = { descricao: b.descricao, data: b.data, quantidade: b.quantidade, valorUnitario: b.valorUnitario.paraString(), valorTotal: total.paraString(), coluna: i };
    itensPorConta.set(b.conta, [...(itensPorConta.get(b.conta) ?? []), { item, total }]);
  }
  const realizadoPorConta = new Map<string, Dinheiro>();
  for (const l of realizado) {
    if (!daConta.has(l.conta) || coluna(l.competencia) < 0) continue;
    realizadoPorConta.set(l.conta, (realizadoPorConta.get(l.conta) ?? Dinheiro.zero()).somar(l.valor));
  }

  const geral = zeros();
  let geralRealizado = Dinheiro.zero();
  const contas: ContaAquisicao[] = [];
  for (const { no, inativa } of analiticas) {
    const itens = itensPorConta.get(no.classificacao) ?? [];
    // Com o filtro de descrição, o realizado da conta não se divide por item: a conta sai só com os bens que casam.
    const real = t ? Dinheiro.zero() : (realizadoPorConta.get(no.classificacao) ?? Dinheiro.zero());
    const visivel = itens.length > 0 || !real.ehZero() || (opcoes.exibirZerados && !inativa && !t);
    if (!visivel) continue;
    const valores = zeros();
    for (const { item, total } of itens) valores[item.coluna] = valores[item.coluna]!.somar(total);
    valores.forEach((v, i) => (geral[i] = geral[i]!.somar(v)));
    geralRealizado = geralRealizado.somar(real);
    contas.push({
      classificacao: no.classificacao,
      descricao: no.descricao,
      inativa,
      valores: valores.map((v) => v.paraString()),
      total: Dinheiro.somarTodos(valores).paraString(),
      realizado: t ? null : real.paraString(),
      itens: itens.map((x) => x.item),
    });
  }
  return {
    colunas,
    contas,
    totalGeral: { valores: geral.map((v) => v.paraString()), total: Dinheiro.somarTodos(geral).paraString(), realizado: t ? null : geralRealizado.paraString() },
    foraDasContas: { quantidade: fora.quantidade, valor: fora.valor.paraString() },
  };
}
