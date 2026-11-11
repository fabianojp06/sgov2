import type { z } from 'zod';

// Porta ProvedorIA (spec §4.4, US-018): o ponto único por onde os módulos falam com a IA,
// independente de fornecedor. Os módulos importam só a porta (`@/shared/ia`); o adaptador
// Anthropic e o falso ficam atrás dela. Esta camada não decide se a IA está ligada, não registra
// chamadas nem aplica tetos: isso é da US-019 (ia_caso_uso, ia_chamada, chaves liga/desliga).
// IA sugere, não grava: nada aqui toca em dado oficial.

/** Modelo padrão (spec §4.4). Cada caso de uso poderá trocar por configuração (US-019). */
export const MODELO_PADRAO = 'claude-opus-5-5';

export type EsforcoIA = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type PedidoIA = {
  /** Instrução do sistema (estável por caso de uso): vai em cache no prefixo. */
  instrucaoSistema: string;
  /** O conteúdo variável da chamada, montado no servidor com os campos permitidos (LGPD). */
  mensagem: string;
  modelo?: string;
  esforco?: EsforcoIA;
  maxTokens?: number;
  /** Para cancelar (tempo limite da rota, usuário saiu da tela). */
  sinal?: AbortSignal;
};

export type UsoIA = { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number };

export type RespostaIA<T> = {
  valor: T;
  /** O modelo que respondeu (pode ser o de fallback, numa recusa do principal). */
  modelo: string;
  uso: UsoIA;
  motivoParada: string;
  latenciaMs: number;
};

/**
 * 'reinicio': o modelo principal recusou no meio e o de fallback recomeçou; a tela descarta o texto
 * já mostrado. O 'fim' traz sempre a resposta final, só com o texto válido.
 */
export type EventoStreamIA = { tipo: 'texto'; texto: string } | { tipo: 'reinicio' } | { tipo: 'fim'; resposta: RespostaIA<string> };

export interface ProvedorIA {
  gerarTexto(pedido: PedidoIA): Promise<RespostaIA<string>>;
  /** Resposta validada contra o schema; fora dele, ErroIA('ia.saida_invalida'). */
  gerarEstruturado<S extends z.ZodType>(pedido: PedidoIA, schema: S): Promise<RespostaIA<z.infer<S>>>;
  /** Texto em pedaços para telas de conversa; o último evento é o 'fim', com a resposta inteira. */
  gerarStream(pedido: PedidoIA): AsyncIterable<EventoStreamIA>;
}

export type CodigoErroIA =
  | 'ia.desabilitada' // sem provedor configurado (produção sem chave)
  | 'ia.recusa' // o modelo (e o fallback) recusou
  | 'ia.limite_tokens' // a resposta foi cortada (max_tokens ou janela de contexto)
  | 'ia.saida_invalida' // a resposta estruturada não bate com o schema
  | 'ia.indisponivel' // 429, 5xx, rede ou tempo esgotado, depois das novas tentativas
  | 'ia.requisicao_invalida' // 400, 404, 422: erro de quem chamou, sem nova tentativa
  | 'ia.autenticacao' // 401, 403: chave inválida ou sem permissão
  | 'ia.cancelada';

const TEMPORARIOS: ReadonlySet<CodigoErroIA> = new Set(['ia.indisponivel']);

/**
 * Erro tipado da IA. A mensagem é fixa por código: nunca leva o texto enviado nem a resposta do
 * provedor (que podem ter dado do usuário). `temporario` diz se vale tentar de novo mais tarde.
 */
export class ErroIA extends Error {
  readonly temporario: boolean;
  constructor(
    readonly codigo: CodigoErroIA,
    readonly detalhes: { status?: number; categoria?: string | null } = {},
  ) {
    super(MENSAGENS[codigo]);
    this.name = 'ErroIA';
    this.temporario = TEMPORARIOS.has(codigo);
  }
}

const MENSAGENS: Record<CodigoErroIA, string> = {
  'ia.desabilitada': 'A IA não está configurada neste ambiente.',
  'ia.recusa': 'A IA recusou o pedido.',
  'ia.limite_tokens': 'A resposta da IA ficou incompleta.',
  'ia.saida_invalida': 'A resposta da IA veio fora do formato esperado.',
  'ia.indisponivel': 'A IA está indisponível no momento. Tente de novo mais tarde.',
  'ia.requisicao_invalida': 'O pedido à IA é inválido.',
  'ia.autenticacao': 'A credencial da IA é inválida.',
  'ia.cancelada': 'O pedido à IA foi cancelado.',
};
