import { Dinheiro, Percentual } from '@/shared/kernel';
import { totalizarSerie, type NoArvore } from '@/shared/totalizer';
import type { NoPlano } from '../domain/totalizador';

// Orçado x Realizado do TP (US-086, parte 1; OxR V2, seção 5; UC04.07). Funções puras (na aplicação por usar o totalizar): a grade mês a mês da seção
// 5.1, com as sintéticas somadas pelo totalizar() (RN_OXR_009, sem arredondamento adicional), o % de uso do mês e do
// período (RN_OXR_010 e 011), "Sem orçamento" (RN_OXR_012), as contas zeradas (RN_OXR_013) e o estouro (RN0314).

export type NoPlanoOxr = NoPlano & { ativa?: boolean; filhos: readonly NoPlanoOxr[] };

export type CelulaOxr = {
  orcado: Dinheiro;
  realizado: Dinheiro;
  /** Realizado ÷ Orçado × 100, 2 casas (RN_OXR_010); nulo com orçado zero. */
  uso: Percentual | null;
  /** RN_OXR_012: orçado zero e realizado diferente de zero. */
  semOrcamento: boolean;
  /** RN0314: uso acima de 100%. */
  estouro: boolean;
};
export type TotalOxr = CelulaOxr & { saldo: Dinheiro };
export type LinhaOxr = { conta: string; descricao: string; nivel: number; analitica: boolean; inativa: boolean; meses: readonly CelulaOxr[]; periodo: TotalOxr };
export type GradeOxr = {
  linhas: readonly LinhaOxr[];
  /** O total das contas mostradas (Despesas e as demais raízes, ou a conta do filtro). */
  total: { meses: readonly CelulaOxr[]; periodo: TotalOxr };
  /** Valores em conta que não está no plano (não acontece com o realizado, que só grava analítica). */
  foraDoPlano: readonly { conta: string; orcado: Dinheiro; realizado: Dinheiro }[];
};

export function celulaOxr(orcado: Dinheiro, realizado: Dinheiro): CelulaOxr {
  const uso = Percentual.razao(realizado, orcado);
  return { orcado, realizado, uso, semOrcamento: orcado.ehZero() && !realizado.ehZero(), estouro: uso !== null && uso.comoFracao().greaterThan(1) };
}

/** RN_OXR_011: totais do período, com o saldo (pode ser negativo). */
export function totalOxr(orcado: Dinheiro, realizado: Dinheiro): TotalOxr {
  return { ...celulaOxr(orcado, realizado), saldo: orcado.subtrair(realizado) };
}

const MESES_TELA = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
/** RN0302: 'AAAA-MM' como Mmm/AA (ex.: Jun/22). */
export const mesOxr = (c: string): string => `${MESES_TELA[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;

/**
 * Monta a grade. `orcado` e `realizado` são 'conta|AAAA-MM' → valor, só das analíticas. Com `conta`, só a subárvore dela
 * (e o total é o dela). Sem `zeradas` (RN_OXR_013), saem as contas com orçado e realizado zero em todo o período.
 */
export function montarGradeOxr(
  plano: readonly NoPlanoOxr[],
  meses: readonly string[],
  orcado: ReadonlyMap<string, Dinheiro>,
  realizado: ReadonlyMap<string, Dinheiro>,
  opcoes: { zeradas: boolean; conta?: string | undefined },
): GradeOxr {
  const nos: NoArvore[] = [];
  const porConta = new Map<string, NoPlanoOxr>();
  const visitar = (lista: readonly NoPlanoOxr[], paiId: string | null) =>
    lista.forEach((n) => {
      nos.push({ id: n.classificacao, paiId, tipo: n.tipo });
      porConta.set(n.classificacao, n);
      visitar(n.filhos, n.classificacao);
    });
  visitar(plano, null);

  const indice = new Map(meses.map((m, i) => [m, i]));
  const series = (valores: ReadonlyMap<string, Dinheiro>) => {
    const dentro = new Map<string, Dinheiro[]>();
    const fora = new Map<string, Dinheiro>();
    for (const [k, v] of valores) {
      const [conta, mes] = k.split('|') as [string, string];
      const i = indice.get(mes);
      if (i === undefined) continue;
      if (porConta.get(conta)?.tipo !== 'ANALITICA') {
        fora.set(conta, (fora.get(conta) ?? Dinheiro.zero()).somar(v));
        continue;
      }
      const s = dentro.get(conta) ?? meses.map(() => Dinheiro.zero());
      s[i] = s[i]!.somar(v);
      dentro.set(conta, s);
    }
    return { serie: totalizarSerie(nos, dentro, meses.length), fora };
  };
  const o = series(orcado);
  const r = series(realizado);

  const linhaDe = (n: NoPlanoOxr): LinhaOxr => {
    const om = o.serie.valor(n.classificacao);
    const rm = r.serie.valor(n.classificacao);
    return {
      conta: n.classificacao,
      descricao: n.descricao,
      nivel: n.nivel,
      analitica: n.tipo === 'ANALITICA',
      inativa: n.ativa === false,
      meses: meses.map((_, i) => celulaOxr(om[i]!, rm[i]!)),
      periodo: totalOxr(Dinheiro.somarTodos(om), Dinheiro.somarTodos(rm)),
    };
  };
  const raiz = opcoes.conta ? porConta.get(opcoes.conta) : undefined;
  const raizes = opcoes.conta ? (raiz ? [raiz] : []) : plano;
  const linhas: LinhaOxr[] = [];
  const percorrer = (lista: readonly NoPlanoOxr[]) =>
    lista.forEach((n) => {
      const l = linhaDe(n);
      if (opcoes.zeradas || !l.periodo.orcado.ehZero() || !l.periodo.realizado.ehZero()) linhas.push(l);
      percorrer(n.filhos);
    });
  percorrer(raizes);

  const somaMes = (s: typeof o.serie, i: number) => Dinheiro.somarTodos(raizes.map((n) => s.valor(n.classificacao)[i]!));
  const totalMeses = meses.map((_, i) => celulaOxr(somaMes(o.serie, i), somaMes(r.serie, i)));
  const foraContas = [...new Set([...o.fora.keys(), ...r.fora.keys()])].sort();
  return {
    linhas,
    total: {
      meses: totalMeses,
      periodo: totalOxr(Dinheiro.somarTodos(totalMeses.map((c) => c.orcado)), Dinheiro.somarTodos(totalMeses.map((c) => c.realizado))),
    },
    foraDoPlano: opcoes.conta ? [] : foraContas.map((conta) => ({ conta, orcado: o.fora.get(conta) ?? Dinheiro.zero(), realizado: r.fora.get(conta) ?? Dinheiro.zero() })),
  };
}
