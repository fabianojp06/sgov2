import Decimal from 'decimal.js';
import { Dinheiro, Percentual } from '@/shared/kernel';

// Cronograma de desembolso da proposta de TP (US-075; UC04.01; plano do P25, D-P25-2 a D-P25-7). Funções puras: a
// série mensal vem do caso de uso, e aqui ficam a distribuição igual das viagens, o acumulado, o % sobre o Valor
// Global, o repasse do ciclo de 12 meses e o fechamento de cada ano. As descrições são geradas aqui (REQ_CD_002).

/**
 * D-P25-2 [PROVISÓRIO]: o valor dividido por igual nos meses, com Half-Even, e o resto dos centavos no último,
 * para a soma bater exato (RN_CD_002).
 */
export function distribuirIgual(valor: Dinheiro, meses: number): Dinheiro[] {
  if (meses <= 0) return [];
  const parcela = valor.dividir(String(meses));
  const partes = Array.from({ length: meses }, () => parcela);
  partes[meses - 1] = valor.subtrair(parcela.multiplicar(String(meses - 1)));
  return partes;
}

export type LinhaCronograma = {
  tipo: 'MES' | 'ANO';
  descricao: string;
  /** "AAAA-MM", só nas linhas de mês. */
  competencia: string | null;
  desembolso: Dinheiro;
  acumulado: Dinheiro;
  /** RN0252: acumulado ÷ Valor Global, com 2 casas; nulo sem Valor Global. */
  percentualAcumulado: Percentual | null;
  /** RN0253: a soma do ciclo de 12 meses na última linha dele; nulo nas outras. */
  repasseCiclo: Dinheiro | null;
};

const mesAno = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/**
 * RN0251 a RN0254 e REQ_CD_002 (D-P25-4 a D-P25-7): uma linha por competência, "Parcela N – MM/AAAA", com o
 * acumulado e o % acumulado; nas linhas 12, 24, 36... (e na última, se o ciclo não fecha) o repasse do ciclo;
 * depois do último mês de cada ano civil, a linha "Total de AAAA".
 */
export function montarCronograma(competencias: readonly string[], porMes: ReadonlyMap<string, Dinheiro>, valorGlobal: Dinheiro): LinhaCronograma[] {
  const linhas: LinhaCronograma[] = [];
  let acumulado = Dinheiro.zero();
  let ciclo = Dinheiro.zero();
  let ano = Dinheiro.zero();
  const percentual = (a: Dinheiro) =>
    valorGlobal.ehZero() ? null : Percentual.dePontos(new Decimal(a.paraString()).dividedBy(valorGlobal.paraString()).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN));
  competencias.forEach((c, i) => {
    const desembolso = porMes.get(c) ?? Dinheiro.zero();
    acumulado = acumulado.somar(desembolso);
    ciclo = ciclo.somar(desembolso);
    ano = ano.somar(desembolso);
    const ultima = i === competencias.length - 1;
    const fechaCiclo = (i + 1) % 12 === 0 || ultima;
    linhas.push({
      tipo: 'MES',
      descricao: `Parcela ${i + 1} – ${mesAno(c)}`,
      competencia: c,
      desembolso,
      acumulado,
      percentualAcumulado: percentual(acumulado),
      repasseCiclo: fechaCiclo ? ciclo : null,
    });
    if (fechaCiclo) ciclo = Dinheiro.zero();
    const fechaAno = ultima || competencias[i + 1]!.slice(0, 4) !== c.slice(0, 4);
    if (fechaAno) {
      linhas.push({
        tipo: 'ANO',
        descricao: `Total de ${c.slice(0, 4)}`,
        competencia: null,
        desembolso: ano,
        acumulado,
        percentualAcumulado: percentual(acumulado),
        repasseCiclo: null,
      });
      ano = Dinheiro.zero();
    }
  });
  return linhas;
}
