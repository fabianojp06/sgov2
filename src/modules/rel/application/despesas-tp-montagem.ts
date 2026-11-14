import type { NoConta } from '@/modules/cad';
import { Dinheiro } from '@/shared/kernel';
import { totalizarSerie, type NoArvore } from '@/shared/totalizer';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02, 2ª tabela): o realizado de cada conta, do início do
// período ao ano anterior numa coluna só e mês a mês no ano de referência (o ano atual, dentro do período; os
// meses futuros saem zerados, RN0303/0305), com o total (REQ0259). Hierarquia: "DESPESAS", as sintéticas, as
// analíticas e as subcontas, na ordem da classificação (RN0295/0297), com recuo (REQ0261). As sintéticas somam
// as analíticas pelo TotalizerService (REQ0269 a 0275). O realizado vem só nas analíticas (RN_OXR_009), pela
// porta do orc (US-085). Função pura, na application/ porque usa o C1 (cad) e o shared/totalizer.
// Revisão 12.12: a árvore inclui as contas INATIVAS (o realizado continua nelas, RN_OXR_001); elas aparecem
// quando têm valor, marcadas. O que não cabe na árvore de despesas (conta sintética ou fora da raiz) é avisado.

/** A raiz das despesas no plano de contas de 5 níveis (spec §6.1). */
export const RAIZ_DESPESAS = '4';
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
const MESES_EXTENSO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'] as const;

export type LinhaRealizado = { conta: string; competencia: string; valor: Dinheiro };
/** `agregada`: a coluna de antes ou de depois do ano de referência (pode ter um mês só). */
export type ColunaDespesas = { rotulo: string; de: string; ate: string; agregada?: boolean };
export type LinhaDespesa = { classificacao: string; descricao: string; nivel: number; analitica: boolean; inativa: boolean; valores: string[]; total: string };
export type Despesas = {
  colunas: ColunaDespesas[];
  linhas: LinhaDespesa[];
  totalGeral: { valores: string[]; total: string };
  /** Lançamentos do período em conta que não é analítica de despesa (não somados no demonstrativo). */
  foraDaArvore: { quantidade: number; valor: string };
};

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ehCompetencia = (c: string) => MES.test(c);
const rotuloMes = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
const rotuloLongo = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]!.toLowerCase()}/${c.slice(0, 4)}`;
/** "2026-09" → "Setembro/2026" (RN0316). */
export const mesPorExtenso = (c: string) => `${MESES_EXTENSO[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const proximo = (c: string) => {
  const [a, m] = [Number(c.slice(0, 4)), Number(c.slice(5, 7))];
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * As colunas do período. O ano de referência é o ano atual, dentro dos anos do período (antes dele, o primeiro;
 * depois, o último). Antes do ano de referência, uma coluna "set/2025 a dez/2026"; no ano, um mês por coluna,
 * dentro do período (os futuros saem zerados); depois dele, se o período passar, uma coluna "jan/2028 a dez/2028".
 */
export function colunasDoPeriodo(de: string, ate: string, anoAtual: number): ColunaDespesas[] {
  if (!ehCompetencia(de) || !ehCompetencia(ate) || de > ate) return [];
  const anoRef = Math.min(Math.max(anoAtual, Number(de.slice(0, 4))), Number(ate.slice(0, 4)));
  const inicioAno = `${anoRef}-01`;
  const fimAno = `${anoRef}-12`;
  const colunas: ColunaDespesas[] = [];
  if (de < inicioAno) {
    const fimAnterior = `${anoRef - 1}-12`;
    colunas.push({ rotulo: `${rotuloLongo(de)} a ${rotuloLongo(fimAnterior)}`, de, ate: fimAnterior, agregada: true });
  }
  const ultimoMes = ate < fimAno ? ate : fimAno;
  for (let c = de > inicioAno ? de : inicioAno; c <= ultimoMes; c = proximo(c)) colunas.push({ rotulo: rotuloMes(c), de: c, ate: c });
  if (ate > fimAno) colunas.push({ rotulo: `${rotuloLongo(`${anoRef + 1}-01`)} a ${rotuloLongo(ate)}`, de: `${anoRef + 1}-01`, ate, agregada: true });
  return colunas;
}

export type NoOrdem = { no: NoConta; nivel: number; inativa: boolean };
/** A árvore das despesas em pré-ordem, com o nível e a marca de inativa (herdada do pai). */
export function nosDaArvore(raizes: readonly NoConta[]): { nos: NoArvore[]; ordem: NoOrdem[] } {
  const nos: NoArvore[] = [];
  const ordem: NoOrdem[] = [];
  const visitar = (n: NoConta, paiId: string | null, nivel: number, inativaAcima: boolean) => {
    const inativa = inativaAcima || !n.ativa;
    nos.push({ id: n.classificacao, paiId, tipo: n.tipo === 'ANALITICA' ? 'ANALITICA' : 'SINTETICA' });
    ordem.push({ no: n, nivel, inativa });
    for (const f of n.filhos) visitar(f, n.classificacao, nivel + 1, inativa);
  };
  for (const r of raizes) visitar(r, null, 0, false);
  return { nos, ordem };
}

export const analiticasDe = (nos: readonly NoArvore[]) => new Set(nos.filter((n) => n.tipo === 'ANALITICA').map((n) => n.id));

/** Distribui as linhas nas colunas, por conta analítica; o que não é analítica da árvore vai para "fora". */
export function distribuir(linhas: readonly LinhaRealizado[], colunas: readonly ColunaDespesas[], analiticas: ReadonlySet<string>) {
  const series = new Map<string, Dinheiro[]>();
  let fora = { quantidade: 0, valor: Dinheiro.zero() };
  for (const l of linhas) {
    const i = colunas.findIndex((c) => c.de <= l.competencia && l.competencia <= c.ate);
    if (i < 0) continue;
    if (!analiticas.has(l.conta)) {
      fora = { quantidade: fora.quantidade + 1, valor: fora.valor.somar(l.valor) };
      continue;
    }
    const serie = series.get(l.conta) ?? colunas.map(() => Dinheiro.zero());
    serie[i] = serie[i]!.somar(l.valor);
    series.set(l.conta, serie);
  }
  return { series, foraDaArvore: { quantidade: fora.quantidade, valor: fora.valor.paraString() } };
}

/**
 * Monta o demonstrativo a partir da árvore de contas do C1 COM as inativas e das linhas do realizado do TP.
 * Oculta: conta inativa sem valor, sempre; conta ativa sem valor, sem "exibir zerados" (RN0383). Uma sintética
 * só some quando todas as contas abaixo dela somem (a hierarquia não quebra com estornos que se anulam).
 */
export function montarDespesas(
  arvore: readonly NoConta[],
  linhas: readonly LinhaRealizado[],
  de: string,
  ate: string,
  opcoes: { exibirZerados: boolean; anoAtual: number },
): Despesas {
  const colunas = colunasDoPeriodo(de, ate, opcoes.anoAtual);
  const { nos, ordem } = nosDaArvore(arvore.filter((n) => n.classificacao === RAIZ_DESPESAS));
  const { series, foraDaArvore } = distribuir(linhas, colunas, analiticasDe(nos));
  if (colunas.length === 0 || nos.length === 0) return { colunas, linhas: [], totalGeral: { valores: colunas.map(() => '0.00'), total: '0.00' }, foraDaArvore };

  const r = totalizarSerie(nos, series, colunas.length);
  const somar = (xs: readonly Dinheiro[]) => xs.reduce((a, b) => a.somar(b), Dinheiro.zero());
  // Visível: a analítica pela regra; a sintética se alguma conta abaixo é visível (ou, com zerados, se ativa).
  const visivel = new Map<string, boolean>();
  for (const { no, inativa } of [...ordem].reverse()) {
    const comValor = r.valor(no.classificacao).some((v) => !v.ehZero());
    const filhosVisiveis = no.filhos.some((f) => visivel.get(f.classificacao));
    visivel.set(no.classificacao, comValor || filhosVisiveis || (opcoes.exibirZerados && !inativa));
  }
  const resultado: LinhaDespesa[] = ordem
    .filter(({ no }) => visivel.get(no.classificacao))
    .map(({ no, nivel, inativa }) => {
      const valores = r.valor(no.classificacao);
      return {
        classificacao: no.classificacao,
        descricao: no.descricao,
        nivel,
        analitica: no.tipo === 'ANALITICA',
        inativa,
        valores: valores.map((v) => v.paraString()),
        total: somar(valores).paraString(),
      };
    });
  return { colunas, linhas: resultado, totalGeral: { valores: r.total.map((v) => v.paraString()), total: somar(r.total).paraString() }, foraDaArvore };
}
