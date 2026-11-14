import { Dinheiro, Percentual } from '@/shared/kernel';

// Previsão de fechamento do ano (US-091; IA-10 da spec §6.8; plano do P34). O motor é determinístico [PROVISÓRIO,
// D-P34-1]: realizado até o mês de corte + orçado dos meses restantes × a tendência da conta, que é o realizado
// acumulado ÷ o orçado acumulado até o corte (sem orçado acumulado, a tendência é 1). A conta está em risco quando o
// projetado do ano passa do orçado do ano; o mês do estouro é o primeiro em que o acumulado projetado passa do orçado
// do ano. A IA só destaca o que o motor calculou (os números vêm daqui, nunca dela).

export type SerieAno = { conta: string; orcado: readonly Dinheiro[]; realizado: readonly Dinheiro[] };

export type PrevisaoConta = {
  conta: string;
  orcadoAno: Dinheiro;
  realizadoAteCorte: Dinheiro;
  projetadoAno: Dinheiro;
  /** Projetado − orçado do ano: positivo é estouro. */
  desvio: Dinheiro;
  /** A tendência usada nos meses restantes (realizado ÷ orçado acumulados até o corte); nula sem orçado acumulado. */
  tendencia: Percentual | null;
  risco: boolean;
  /** 'AAAA-MM' do primeiro mês em que o acumulado projetado passa do orçado do ano; nulo sem risco. */
  mesEstouro: string | null;
};

const somar = (xs: readonly Dinheiro[]) => Dinheiro.somarTodos(xs);

/** `meses` são as competências do ano ('AAAA-MM', em ordem); `corte` é o índice do último mês com realizado (−1: nenhum). */
export function preverConta(meses: readonly string[], corte: number, s: SerieAno): PrevisaoConta {
  const orcadoAno = somar(s.orcado);
  const orcadoAcum = somar(s.orcado.slice(0, corte + 1));
  const realizadoAteCorte = somar(s.realizado.slice(0, corte + 1));
  const fator = !orcadoAcum.ehZero() ? realizadoAteCorte.paraDecimal().dividedBy(orcadoAcum.paraDecimal()) : null;
  const projecao = meses.map((_, i) => (i <= corte ? s.realizado[i]! : fator ? s.orcado[i]!.multiplicar(fator) : s.orcado[i]!));
  const projetadoAno = somar(projecao);
  let acumulado = Dinheiro.zero();
  let mesEstouro: string | null = null;
  for (const [i, v] of projecao.entries()) {
    acumulado = acumulado.somar(v);
    if (mesEstouro === null && acumulado.comparar(orcadoAno) > 0) mesEstouro = meses[i]!;
  }
  const risco = projetadoAno.comparar(orcadoAno) > 0;
  return {
    conta: s.conta,
    orcadoAno,
    realizadoAteCorte,
    projetadoAno,
    desvio: projetadoAno.subtrair(orcadoAno),
    tendencia: Percentual.razao(realizadoAteCorte, orcadoAcum),
    risco,
    mesEstouro: risco ? mesEstouro : null,
  };
}
