// Avaliação de qualidade de um caso de uso de IA (US-019; pedido da frente A na #138 para a #84): o
// Administrador pede na tela /int/ia, e o worker roda, pela fila ia.avaliar, o avaliador que o módulo
// dono registrou para o caso. O avaliador faz as chamadas pelo servicoIA como a pessoa que pediu: monta o
// QuemPedeIA pelo usuarioId (com as permissões dela, como o revisor do orc) e marca
// `isentoLimitePorMinuto`, porque a avaliação faz muitas chamadas seguidas; custo no teto e no registro.
// Devolve só números e um resumo numérico, sem texto de usuário.

export const FILA_AVALIACAO_IA = 'ia.avaliar' as const;
/** Tempo máximo de uma avaliação: o `sinal` cancela as chamadas depois disso. */
export const MINUTOS_AVALIACAO_IA = 15;
/** Pendente há mais que isto: vencida (o worker caiu ou o job se perdeu); a tela aceita um pedido novo. */
export const MINUTOS_AVALIACAO_VENCIDA = 30;

export type PedidoAvaliacaoIA = Readonly<{
  avaliacaoId: string;
  casoUsoCodigo: string;
  usuarioId: string;
  /** Repassar ao servicoIA: cancela as chamadas no fim do tempo da avaliação. */
  sinal: AbortSignal;
}>;

export type ResultadoAvaliacaoIA = Readonly<{
  /** Exemplos avaliados (inteiro ≥ 0). */
  total: number;
  /** Exemplos com a resposta esperada (0 ≤ acertos ≤ total). */
  acertos: number;
  /** Detalhes numéricos para a tela (ex.: { taxa: 0.8, errosIa: 1 }); nunca texto de usuário. */
  resumo?: Readonly<Record<string, number | Readonly<Record<string, number>>>>;
}>;

/** Avaliador de um caso de uso, registrado no worker pelo módulo dono, com o código do caso como chave. */
export type AvaliadorCasoIA = (pedido: PedidoAvaliacaoIA) => Promise<ResultadoAvaliacaoIA>;
