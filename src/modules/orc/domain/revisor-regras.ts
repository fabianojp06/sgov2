import { Dinheiro, Percentual } from '@/shared/kernel';
import type { Prioridade } from './pacote';

// Revisor de consistência antes do envio (US-064; plano do P14, D-P14-7). Os achados de número são
// regras determinísticas, aqui, sem IA (§6.8, princípio 1); a IA só acrescenta achados de texto e
// coerência. Funções puras, com Dinheiro. Valores [PROVISÓRIOS].

/** R2: aumento de mais de 50 % sobre o ano anterior... */
export const FATOR_AUMENTO = '1.5';
/** ...e diferença de pelo menos R$ 10.000,00. */
export const DIFERENCA_MINIMA = '10000.00';

export const SITUACOES_REVISAO = ['PENDENTE', 'CONCLUIDA', 'FALHOU'] as const;
export type SituacaoRevisao = (typeof SITUACOES_REVISAO)[number];

export const TIPOS_REGRA = ['DUPLICADO', 'AUMENTO_ANO_ANTERIOR', 'DESEJAVEIS_ACIMA_DO_TETO'] as const;
export type TipoRegra = (typeof TIPOS_REGRA)[number];
export const TIPOS_ACHADO_IA = ['DUPLICADO_PROVAVEL', 'JUSTIFICATIVA_FRACA', 'CONTA_INCOERENTE', 'OUTRO'] as const;
export type TipoAchadoIA = (typeof TIPOS_ACHADO_IA)[number];

/** O que a tela mostra: o achado já com os links para as linhas do exercício revisado. */
export type Achado = { origem: 'REGRA' | 'IA'; tipo: string; texto: string; links: readonly { rotulo: string; href: string }[] };
export type RevisaoTela = {
  situacao: SituacaoRevisao;
  achados: readonly Achado[];
  avisos: readonly string[];
  desatualizada: boolean;
  concluidaEm: Date | null;
};

// [PROVISÓRIOS]
export const ROTULO_TIPO_ACHADO: Readonly<Record<TipoRegra | TipoAchadoIA, string>> = {
  DUPLICADO: 'Pacotes duplicados',
  AUMENTO_ANO_ANTERIOR: 'Aumento sobre o ano anterior',
  DESEJAVEIS_ACIMA_DO_TETO: 'Desejáveis acima do teto',
  DUPLICADO_PROVAVEL: 'Lançamento provavelmente duplicado',
  JUSTIFICATIVA_FRACA: 'Justificativa fraca',
  CONTA_INCOERENTE: 'Conta incoerente com a justificativa',
  OUTRO: 'Outro ponto de atenção',
};

export type PacoteRegra = { id: string; cc: string; conta: string; prioridade: Prioridade; anual: Dinheiro; justificativa: string };
export type TotalPar = { cc: string; conta: string; total: Dinheiro };

/** Achado de regra, antes dos links: os pacotes citados e, na R2, o par CC × conta. */
export type AchadoRegra = { tipo: TipoRegra; texto: string; pacotes: readonly string[]; par: { cc: string; conta: string } | null };

/** Justificativa comparável: sem caixa, sem acentos e com os espaços repetidos (e nas pontas) reduzidos. */
export function normalizarJustificativa(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/** R1: mesmo CC, conta, valor anual e justificativa normalizada. Um achado por grupo, com os ids em ordem. */
export function regraDuplicados(pacotes: readonly PacoteRegra[]): AchadoRegra[] {
  const grupos = new Map<string, PacoteRegra[]>();
  for (const p of pacotes) {
    const chave = [p.cc, p.conta, p.anual.paraString(), normalizarJustificativa(p.justificativa)].join('\u0000');
    grupos.set(chave, [...(grupos.get(chave) ?? []), p]);
  }
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      tipo: 'DUPLICADO' as const,
      texto: `${g.length} pacotes iguais no CC ${g[0]!.cc}, conta ${g[0]!.conta}, com ${g[0]!.anual.formatar()} por ano cada e a mesma justificativa.`,
      pacotes: g.map((p) => p.id),
      par: null,
    }));
}

/** Soma por par CC × conta. */
export function totaisPorPar(linhas: readonly TotalPar[]): Map<string, TotalPar> {
  const m = new Map<string, TotalPar>();
  for (const l of linhas) {
    const chave = `${l.cc}|${l.conta}`;
    const atual = m.get(chave);
    m.set(chave, { cc: l.cc, conta: l.conta, total: atual ? atual.total.somar(l.total) : l.total });
  }
  return m;
}

/**
 * R2: o total do par CC × conta passou de 150 % do oficializado no ano anterior, com diferença de pelo
 * menos R$ 10.000,00. Par sem valor no ano anterior não tem base de comparação e fica de fora.
 */
export function regraAumento(atual: readonly TotalPar[], anterior: readonly TotalPar[]): AchadoRegra[] {
  const antes = totaisPorPar(anterior);
  const minimo = Dinheiro.de(DIFERENCA_MINIMA);
  const achados: AchadoRegra[] = [];
  for (const p of [...totaisPorPar(atual).values()].sort((a, b) => a.cc.localeCompare(b.cc) || a.conta.localeCompare(b.conta))) {
    const base = antes.get(`${p.cc}|${p.conta}`)?.total;
    if (!base || base.ehZero() || base.ehNegativo()) continue;
    const diferenca = p.total.subtrair(base);
    if (p.total.comparar(base.multiplicar(FATOR_AUMENTO)) <= 0 || diferenca.comparar(minimo) < 0) continue;
    const pct = Percentual.razao(diferenca, base);
    achados.push({
      tipo: 'AUMENTO_ANO_ANTERIOR',
      texto: `CC ${p.cc}, conta ${p.conta}: ${p.total.formatar()} contra ${base.formatar()} no ano anterior (+${pct?.formatar() ?? ''}, +${diferenca.formatar()}).`,
      pacotes: [],
      par: { cc: p.cc, conta: p.conta },
    });
  }
  return achados;
}

/** R3: orçado acima do teto efetivo; lista os pacotes Desejáveis, do maior anual para o menor. */
export function regraDesejaveis(orcado: Dinheiro, teto: Dinheiro, pacotes: readonly PacoteRegra[]): AchadoRegra[] {
  if (orcado.comparar(teto) <= 0) return [];
  const desejaveis = pacotes.filter((p) => p.prioridade === 'DESEJAVEL').sort((a, b) => b.anual.comparar(a.anual) || a.id.localeCompare(b.id));
  const excesso = orcado.subtrair(teto);
  const lista =
    desejaveis.length === 0
      ? 'Não há pacotes Desejáveis para rever.'
      : `${desejaveis.length === 1 ? 'O pacote Desejável' : `Os ${desejaveis.length} pacotes Desejáveis`}, do maior para o menor, são os primeiros a rever.`;
  return [
    {
      tipo: 'DESEJAVEIS_ACIMA_DO_TETO',
      texto: `O orçado (${orcado.formatar()}) passa o teto (${teto.formatar()}) em ${excesso.formatar()}. ${lista}`,
      pacotes: desejaveis.map((p) => p.id),
      par: null,
    },
  ];
}
