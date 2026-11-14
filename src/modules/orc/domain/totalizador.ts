import { Dinheiro } from '@/shared/kernel';

// Totalizadores da proposta de TP (US-074; UC03.02; plano do P23, D-P23-2 e D-P23-3). Funções puras: as somas
// das sintéticas vêm do totalizar() (RN_TOT_02), e aqui ficam o semáforo da RN_TOT_04 e a montagem da árvore
// que a tela mostra, sem os ramos zerados.

export const SEMAFOROS = ['VERDE', 'AMARELO', 'LARANJA', 'VERMELHO'] as const;
export type Semaforo = (typeof SEMAFOROS)[number];
export const ROTULO_SEMAFORO: Readonly<Record<Semaforo, string>> = { VERDE: 'Verde', AMARELO: 'Amarelo', LARANJA: 'Laranja', VERMELHO: 'Vermelho' };

/**
 * RN_TOT_04 (D-P23-2) [PROVISÓRIO]: uso = realizado ÷ orçado. Verde até 70%, amarelo até 85%, laranja até 95% e
 * vermelho acima (estouro). Orçado zero: verde sem realizado, vermelho com realizado.
 */
export function semaforo(orcado: Dinheiro, realizado: Dinheiro): Semaforo {
  const o = orcado.paraDecimal();
  const r = realizado.paraDecimal().times(100);
  if (o.isZero()) return r.isZero() ? 'VERDE' : 'VERMELHO';
  if (r.lte(o.times(70))) return 'VERDE';
  if (r.lte(o.times(85))) return 'AMARELO';
  if (r.lte(o.times(95))) return 'LARANJA';
  return 'VERMELHO';
}

/** O nó do plano de contas que a árvore precisa (o NoConta do C1 tem esse formato; o domain não importa o cad). */
export type NoPlano = { classificacao: string; descricao: string; nivel: number; tipo: 'SINTETICA' | 'ANALITICA'; filhos: readonly NoPlano[] };

export type NoTotal = {
  classificacao: string;
  descricao: string;
  nivel: number;
  analitica: boolean;
  orcado: Dinheiro;
  realizado: Dinheiro;
  saldo: Dinheiro;
  semaforo: Semaforo;
  filhos: readonly NoTotal[];
};

/**
 * REQ_TOT_001 e D-P23-3: a árvore do plano de contas com os valores, só com os ramos que têm algum valor orçado ou
 * realizado. Sem `realizadoDe`, o realizado é zero (pré-visualização); nos totalizadores, é o carregado (US-085,
 * D-P33-5).
 */
export function montarArvore(
  contas: readonly NoPlano[],
  orcadoDe: (classificacao: string) => Dinheiro,
  realizadoDe: (classificacao: string) => Dinheiro = () => Dinheiro.zero(),
): NoTotal[] {
  return contas.flatMap((n): NoTotal[] => {
    const orcado = orcadoDe(n.classificacao);
    const realizado = realizadoDe(n.classificacao);
    if (orcado.ehZero() && realizado.ehZero()) return [];
    return [
      {
        classificacao: n.classificacao,
        descricao: n.descricao,
        nivel: n.nivel,
        analitica: n.tipo === 'ANALITICA',
        orcado,
        realizado,
        saldo: orcado.subtrair(realizado),
        semaforo: semaforo(orcado, realizado),
        filhos: montarArvore(n.filhos, orcadoDe, realizadoDe),
      },
    ];
  });
}

/**
 * D-P23-3: separa o que cai numa analítica ativa do plano (vai ao totalizar) do que ficou numa conta fora do
 * plano ativo (vai à linha à parte, para o total não perder valor; Review Focus 5).
 */
export function separarPorPlano(porConta: ReadonlyMap<string, Dinheiro>, noPlano: (conta: string) => boolean) {
  const dentro = new Map<string, Dinheiro>();
  const fora: { conta: string; valor: Dinheiro }[] = [];
  for (const [conta, valor] of porConta) {
    if (valor.ehZero()) continue;
    if (noPlano(conta)) dentro.set(conta, valor);
    else fora.push({ conta, valor });
  }
  return { dentro, fora: fora.sort((a, b) => a.conta.localeCompare(b.conta, 'pt-BR', { numeric: true })) };
}
