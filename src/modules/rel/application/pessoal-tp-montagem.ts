import { Dinheiro } from '@/shared/kernel';

// Relatórios de pessoal do TP (US-098; UC05.05 e UC05.06), com os empregados da versão oficializada da proposta
// (decisão do PO no #120: o previsto, até a integração com a folha). Funções puras: o filtro, a numeração e o
// agrupamento por setor. Os campos sem fonte (Lotação, "Adm." e Produto do UC05.06) ficam fora (#120).

export const CATEGORIAS_PESSOAL = ['EMPREGADO', 'ESTAGIARIO', 'JOVEM_APRENDIZ'] as const;
export type CategoriaPessoal = (typeof CATEGORIAS_PESSOAL)[number];
export const ROTULO_CATEGORIA: Readonly<Record<CategoriaPessoal, string>> = { EMPREGADO: 'Empregado', ESTAGIARIO: 'Estagiário', JOVEM_APRENDIZ: 'Jovem Aprendiz' };
/** O nome vazio é a vaga ainda não preenchida (RN0249 do orc). */
export const A_CONTRATAR = 'A CONTRATAR';

/** O que a porta do orc entrega por empregado da versão oficializada (`empregadosDaVersaoOficial`, #544). */
export type EmpregadoDaVersao = {
  ordem: number;
  nome: string | null;
  categoria: CategoriaPessoal;
  cargo: string;
  /** O nó da estrutura funcional ligado ao cargo (o setor, RN0442); nulo se o cargo não tem. */
  vinculoFuncional: string | null;
  /** "AAAA-MM". */
  inicio: string;
  fim: string;
  metaNumero: string | null;
  metaNome: string | null;
  /** O custo do primeiro mês; nulo para quem não vê o custo do pessoal (o mascaramento é do orc) ou sem cálculo. */
  custoMensal: Dinheiro | null;
};

export type FiltrosPessoal = { de: string; ate: string; cargo: string; meta: string; categoria: CategoriaPessoal | '' };

export type LinhaPessoal = {
  seq: number;
  nome: string;
  categoria: string;
  cargo: string;
  setor: string;
  meta: string | null;
  inicio: string;
  fim: string;
  custo: string | null;
};

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const contem = (valor: string | null, filtro: string) => !semAcento(filtro) || semAcento(valor ?? '').includes(semAcento(filtro));
export const SEM_SETOR = 'Sem setor';
const rotuloMeta = (e: EmpregadoDaVersao) => (e.metaNumero ? `${e.metaNumero} – ${e.metaNome ?? ''}`.trim() : null);

/**
 * Os empregados do período (o contrato cruza o período), filtrados por cargo, meta e categoria (REQ0327/0335,
 * combináveis, REQ0329/0336), em ordem de meta e de ordem, numerados de 1 (Seq). A meta só sai em TP por meta (RN0245).
 */
export function linhasDePessoal(empregados: readonly EmpregadoDaVersao[], f: FiltrosPessoal, porMeta: boolean): LinhaPessoal[] {
  const num = { numeric: true } as const;
  return empregados
    .filter((e) => e.inicio <= f.ate && e.fim >= f.de)
    .filter((e) => contem(e.cargo, f.cargo) && (!porMeta || contem(rotuloMeta(e), f.meta)) && (!f.categoria || e.categoria === f.categoria))
    // Sem meta (a Consolidada) por último, como no orc (RN0148).
    .sort((a, b) => (a.metaNumero ?? '\uffff').localeCompare(b.metaNumero ?? '\uffff', 'pt-BR', num) || a.ordem - b.ordem)
    .map((e, i) => ({
      seq: i + 1,
      nome: e.nome ?? A_CONTRATAR,
      categoria: ROTULO_CATEGORIA[e.categoria],
      cargo: e.cargo,
      setor: e.vinculoFuncional ?? SEM_SETOR,
      meta: porMeta ? rotuloMeta(e) : null,
      inicio: e.inicio,
      fim: e.fim,
      custo: e.custoMensal ? e.custoMensal.paraString() : null,
    }));
}

/** O total dos custos mensais, ou nulo se o perfil não vê o custo (REQ0331: sem valor, 0,00). */
export function totalCustos(linhas: readonly LinhaPessoal[], veCusto: boolean): string | null {
  if (!veCusto) return null;
  return linhas.reduce((t, l) => t.somar(Dinheiro.de(l.custo ?? '0')), Dinheiro.zero()).paraString();
}

/**
 * Agrupa por setor (RN0442; o cadastro da estrutura funcional tem só o nome), em ordem; o "Sem setor" por último. O Seq é
 * renumerado na ordem dos grupos, para seguir 1, 2, 3 na tela (revisão 12.12).
 */
export function porSetor(linhas: readonly LinhaPessoal[]): { setor: string; linhas: LinhaPessoal[] }[] {
  const grupos = new Map<string, LinhaPessoal[]>();
  for (const l of linhas) grupos.set(l.setor, [...(grupos.get(l.setor) ?? []), l]);
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === SEM_SETOR ? 1 : b === SEM_SETOR ? -1 : a.localeCompare(b, 'pt-BR')))
    .map(([setor, ls]) => ({ setor, linhas: ls }))
    .reduce<{ setor: string; linhas: LinhaPessoal[] }[]>((gs, g) => {
      const antes = gs.reduce((n, x) => n + x.linhas.length, 0);
      return [...gs, { setor: g.setor, linhas: g.linhas.map((l, i) => ({ ...l, seq: antes + i + 1 })) }];
    }, []);
}
