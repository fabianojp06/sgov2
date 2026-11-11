// Avaliação de qualidade de um caso de uso de IA (US-019; pedido da frente A na #138 para a #84): o
// Administrador pede na tela /int/ia, e o worker roda, pela fila ia.avaliar, o avaliador que o módulo
// dono registrou para o caso. O avaliador faz as chamadas pelo servicoIA, como a pessoa que pediu (custo
// no teto e no registro), e devolve só números e um resumo sem texto de usuário.

export const FILA_AVALIACAO_IA = 'ia.avaliar' as const;

export type PedidoAvaliacaoIA = Readonly<{ avaliacaoId: string; casoUsoCodigo: string; usuarioId: string }>;

export type ResultadoAvaliacaoIA = Readonly<{
  /** Exemplos avaliados (inteiro ≥ 0). */
  total: number;
  /** Exemplos com a resposta esperada (0 ≤ acertos ≤ total). */
  acertos: number;
  /** Detalhes para a tela (por exemplo, acertos por categoria); nunca o texto de usuário. */
  resumo?: Readonly<Record<string, unknown>>;
}>;

/** Avaliador de um caso de uso, registrado no worker pelo módulo dono, com o código do caso como chave. */
export type AvaliadorCasoIA = (pedido: PedidoAvaliacaoIA) => Promise<ResultadoAvaliacaoIA>;
