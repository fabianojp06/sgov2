import { Dinheiro, Percentual } from '@/shared/kernel';
import type { Prioridade } from './pacote';

// Revisor de consistência antes do envio (US-064; plano do P14, D-P14-7). Os achados de número são
// regras determinísticas, aqui, sem IA (§6.8, princípio 1); a IA só acrescenta achados de texto e
// coerência. Funções puras, com Dinheiro. Valores [PROVISÓRIOS].

/** R2: aumento de mais de 50 % sobre o ano anterior (atual × 2 > anterior × 3, sem arredondar) e diferença de pelo menos R$ 10.000,00. */
export const DIFERENCA_MINIMA = '10000.00';
/** PENDENTE há mais tempo que isto: aparece como FALHOU, libera um pedido novo e o worker não a processa. */
export const MINUTOS_REVISAO_PARADA = 15;
export const REVISAO_PARADA_MS = MINUTOS_REVISAO_PARADA * 60_000;

/**
 * Prefixo do aviso que só aparece a quem tem orc.posicoes:consultar (plano do P15, D-P15-4; B3). A coluna
 * avisos continua text[]: o ultimaRevisao tira o prefixo na leitura e descarta o aviso para quem não tem
 * a permissão. Revisões antigas não têm o prefixo e saem como estão.
 */
export const AVISO_SO_POSICOES = '[posicoes] ';

export const SITUACOES_REVISAO = ['PENDENTE', 'CONCLUIDA', 'FALHOU'] as const;
export type SituacaoRevisao = (typeof SITUACOES_REVISAO)[number];

export const TIPOS_REGRA = ['DUPLICADO', 'AUMENTO_ANO_ANTERIOR', 'DESEJAVEIS_ACIMA_DO_TETO', 'POSICAO_SEM_BENEFICIO', 'SALARIO_FORA_DA_FAIXA'] as const;
export type TipoRegra = (typeof TIPOS_REGRA)[number];
export const TIPOS_ACHADO_IA = ['DUPLICADO_PROVAVEL', 'JUSTIFICATIVA_FRACA', 'CONTA_INCOERENTE', 'OUTRO'] as const;
export type TipoAchadoIA = (typeof TIPOS_ACHADO_IA)[number];

/**
 * Link de um achado para a linha do exercício revisado, com o alvo: o tipo (pacote, posição ou par CC ×
 * conta) e, no par, se ele tem linha de pessoal. Com o alvo, a tela filtra pelo que quem vê pode
 * consultar (filtrarAchados). `salario`: o achado fala do salário da posição diante da faixa de mercado
 * do cargo (R5, ou achado da IA sobre uma posição da R5; plano do P15, D-P15-4).
 */
export type LinkAchado = { rotulo: string; href: string; tipo: 'pacote' | 'posicao' | 'par'; pessoal?: boolean; salario?: boolean };
/** O que a tela mostra: o achado já com os links para as linhas do exercício revisado. */
export type Achado = { origem: 'REGRA' | 'IA'; tipo: string; texto: string; links: readonly LinkAchado[] };

/**
 * O que quem vê a revisão pode consultar (D-P12-3: o salário, e o total de pessoal, só com incluir ou
 * alterar posição; R24: a faixa de mercado do cargo só com cad.salarios:consultar, em salariosCargo).
 */
export type AlcanceRevisao = { pacotes: boolean; posicoes: boolean; salario: boolean; salariosCargo: boolean };

/**
 * Os achados que quem vê pode ver: o achado sai inteiro quando cita uma linha que a pessoa não pode
 * consultar (o texto pode falar dela): pacote sem orc.pacotes:consultar, posição sem
 * orc.posicoes:consultar, par com pessoal sem ver salário, posição com salário (R5) sem ver o salário
 * da posição e o do cadastro de cargos.
 */
export function filtrarAchados(achados: readonly Achado[], alcance: AlcanceRevisao): Achado[] {
  const posicao = (l: LinkAchado) => alcance.posicoes && (!l.salario || (alcance.salario && alcance.salariosCargo));
  const pode = (l: LinkAchado) => (l.tipo === 'pacote' ? alcance.pacotes : l.tipo === 'posicao' ? posicao(l) : !l.pessoal || alcance.salario);
  return achados.filter((a) => a.links.every(pode));
}
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
  POSICAO_SEM_BENEFICIO: 'Posições sem benefício',
  SALARIO_FORA_DA_FAIXA: 'Salário fora da faixa do cargo',
  DUPLICADO_PROVAVEL: 'Lançamento provavelmente duplicado',
  JUSTIFICATIVA_FRACA: 'Justificativa fraca',
  CONTA_INCOERENTE: 'Conta incoerente com a justificativa',
  OUTRO: 'Outro ponto de atenção',
};

export type PacoteRegra = { id: string; cc: string; conta: string; prioridade: Prioridade; anual: Dinheiro; justificativa: string };
export type TotalPar = { cc: string; conta: string; total: Dinheiro };

/**
 * Achado de regra, antes dos links: os pacotes ou as posições citados e, na R2, o par CC × conta.
 * `salario`: os links das posições levam a marca de salário (R5).
 */
export type AchadoRegra = {
  tipo: TipoRegra;
  texto: string;
  pacotes: readonly string[];
  posicoes: readonly string[];
  par: { cc: string; conta: string } | null;
  salario: boolean;
};

/** Posição com cargo do cadastro, só para as regras R4 e R5 (o salário não sai daqui para a IA). */
export type PosicaoRegra = { id: string; cc: string; cargoId: string; cargoNome: string; salarioMensal: Dinheiro };

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
      posicoes: [],
      par: null,
      salario: false,
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
    if (p.total.multiplicar('2').comparar(base.multiplicar('3')) <= 0 || diferenca.comparar(minimo) < 0) continue;
    const pct = Percentual.razao(diferenca, base);
    achados.push({
      tipo: 'AUMENTO_ANO_ANTERIOR',
      texto: `CC ${p.cc}, conta ${p.conta}: ${p.total.formatar()} contra ${base.formatar()} no ano anterior (+${pct?.formatar() ?? ''}, +${diferenca.formatar()}).`,
      pacotes: [],
      posicoes: [],
      par: { cc: p.cc, conta: p.conta },
      salario: false,
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
      posicoes: [],
      par: null,
      salario: false,
    },
  ];
}

const porCc = (a: PosicaoRegra, b: PosicaoRegra) => a.cc.localeCompare(b.cc) || a.id.localeCompare(b.id);

/**
 * R4 (plano do P15, D-P15-4): posições de cargo sem benefício no exercício (`semBeneficio`: os cargoId
 * cujo beneficiosDoCargo não tem benefício: nenhum escolhido, ou nenhum com valor na Tabela Mestre). Um achado por cargo, com as posições em ordem de CC.
 */
export function regraSemBeneficio(posicoes: readonly PosicaoRegra[], semBeneficio: ReadonlySet<string>): AchadoRegra[] {
  const porCargo = new Map<string, PosicaoRegra[]>();
  for (const p of posicoes) if (semBeneficio.has(p.cargoId)) porCargo.set(p.cargoId, [...(porCargo.get(p.cargoId) ?? []), p]);
  return [...porCargo.values()]
    .map((g) => [...g].sort(porCc))
    .sort((a, b) => a[0]!.cargoNome.localeCompare(b[0]!.cargoNome, 'pt-BR') || a[0]!.cargoId.localeCompare(b[0]!.cargoId))
    .map((g) => ({
      tipo: 'POSICAO_SEM_BENEFICIO' as const,
      texto: `Cargo ${g[0]!.cargoNome}: ${g.length === 1 ? '1 posição' : `${g.length} posições`} sem benefício calculável no exercício.`,
      pacotes: [],
      posicoes: g.map((p) => p.id),
      par: null,
      salario: false,
    }));
}

/**
 * R5 (plano do P15, D-P15-4): salário mensal gravado menor que o mínimo ou maior que o máximo da faixa de
 * mercado do cargo (o limite está dentro). Um achado por posição; cargo sem faixa fica de fora. O texto
 * nunca leva o salário, a faixa nem a diferença (a direção só aparece a quem vê os dois, filtrarAchados).
 */
export function regraForaDaFaixa(posicoes: readonly PosicaoRegra[], faixas: ReadonlyMap<string, { minimo: Dinheiro; maximo: Dinheiro } | null>): AchadoRegra[] {
  const achados: AchadoRegra[] = [];
  for (const p of [...posicoes].sort(porCc)) {
    const faixa = faixas.get(p.cargoId);
    if (!faixa) continue;
    const direcao = p.salarioMensal.comparar(faixa.minimo) < 0 ? 'abaixo do mínimo' : p.salarioMensal.comparar(faixa.maximo) > 0 ? 'acima do máximo' : null;
    if (!direcao) continue;
    achados.push({
      tipo: 'SALARIO_FORA_DA_FAIXA',
      texto: `CC ${p.cc}, cargo ${p.cargoNome}: salário mensal ${direcao} da faixa de mercado do cargo.`,
      pacotes: [],
      posicoes: [p.id],
      par: null,
      salario: true,
    });
  }
  return achados;
}
