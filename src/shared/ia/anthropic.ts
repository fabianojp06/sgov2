import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { ErroIA, MODELO_PADRAO, type EventoStreamIA, type PedidoIA, type ProvedorIA, type RespostaIA, type UsoIA } from './porta';

// Adaptador Anthropic da porta ProvedorIA (spec §4.4, US-018), com o SDK oficial:
// - adaptive thinking (o único modo do claude-opus-5-5) e o esforço por pedido (padrão "medium");
// - prompt caching na instrução do sistema, que é o prefixo estável de cada caso de uso;
// - fallback do lado do servidor ("default"): numa recusa por política, a API refaz o pedido no modelo
//   recomendado para a categoria, na mesma chamada;
// - stop_reason conferido antes do conteúdo: recusa e corte viram ErroIA;
// - novas tentativas do próprio SDK em 408/409/429/5xx e falha de rede, com espera crescente; 400,
//   401, 403, 404 e 422 não são tentados de novo.
// A chave vem de quem cria o adaptador (criarProvedorIA lê ANTHROPIC_API_KEY, que só existe no
// Easypanel); nada aqui a registra.

const FALLBACK = 'server-side-fallback-2026-07-01';
const MAX_TOKENS_PADRAO = 16_000;
const ESFORCO_PADRAO = 'medium';

export type OpcoesAnthropic = {
  apiKey: string;
  /** Novas tentativas do SDK em erro temporário (padrão 3). */
  novasTentativas?: number;
  /** Tempo limite de cada tentativa, em ms (padrão 2 min). */
  tempoLimiteMs?: number;
  /** Só para os testes de contrato: respostas sem rede. */
  fetch?: typeof globalThis.fetch;
  agora?: () => number;
};

type Mensagem = Anthropic.Beta.Messages.BetaMessage;

export function criarProvedorAnthropic(o: OpcoesAnthropic): ProvedorIA {
  if (!o.apiKey.trim()) throw new ErroIA('ia.desabilitada');
  const cliente = new Anthropic({
    apiKey: o.apiKey,
    // Fixos, e não do ambiente: ANTHROPIC_BASE_URL mandaria a chave a outro host, e ANTHROPIC_LOG=debug
    // gravaria no log o corpo dos pedidos, com dado do usuário (LGPD).
    baseURL: 'https://api.anthropic.com',
    logLevel: 'warn',
    maxRetries: o.novasTentativas ?? 3,
    timeout: o.tempoLimiteMs ?? 120_000,
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  const agora = o.agora ?? (() => performance.now());

  const parametros = (p: PedidoIA) => ({
    model: p.modelo ?? MODELO_PADRAO,
    max_tokens: p.maxTokens ?? MAX_TOKENS_PADRAO,
    system: [{ type: 'text' as const, text: p.instrucaoSistema, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: p.mensagem }],
    thinking: { type: 'adaptive' as const },
    betas: [FALLBACK],
    fallbacks: 'default' as const,
  });
  const opcoes = (p: PedidoIA) => (p.sinal ? { signal: p.sinal } : {});

  const resposta = <T>(m: Mensagem, valor: T, inicio: number): RespostaIA<T> => ({
    valor,
    modelo: m.model,
    uso: uso(m.usage),
    motivoParada: m.stop_reason ?? 'desconhecido',
    latenciaMs: Math.round(agora() - inicio),
  });

  return {
    async gerarTexto(p) {
      const inicio = agora();
      try {
        const m = await cliente.beta.messages.create({ ...parametros(p), output_config: { effort: p.esforco ?? ESFORCO_PADRAO } }, opcoes(p));
        conferir(m);
        return resposta(m, texto(m), inicio);
      } catch (e) {
        return traduzir(e);
      }
    },

    async gerarEstruturado<S extends z.ZodType>(p: PedidoIA, schema: S): Promise<RespostaIA<z.infer<S>>> {
      const inicio = agora();
      try {
        // create (e não parse): o stop_reason é conferido antes de ler o JSON, e uma resposta cortada
        // vira ia.limite_tokens, não ia.saida_invalida.
        const m = await cliente.beta.messages.create(
          { ...parametros(p), output_config: { effort: p.esforco ?? ESFORCO_PADRAO, format: betaZodOutputFormat(schema) } },
          opcoes(p),
        );
        conferir(m);
        const lido = schema.safeParse(jsonOuNada(texto(m)));
        if (!lido.success) throw new ErroIA('ia.saida_invalida', { uso: uso(m.usage), modelo: m.model });
        return resposta(m, lido.data as z.infer<S>, inicio);
      } catch (e) {
        return traduzir(e);
      }
    },

    async *gerarStream(p): AsyncGenerator<EventoStreamIA> {
      const inicio = agora();
      try {
        const stream = cliente.beta.messages.stream({ ...parametros(p), output_config: { effort: p.esforco ?? ESFORCO_PADRAO } }, opcoes(p));
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield { tipo: 'texto', texto: ev.delta.text };
          // O modelo principal recusou no meio e o de fallback continua: a tela descarta o que já mostrou.
          if (ev.type === 'content_block_start' && ev.content_block.type === 'fallback') yield { tipo: 'reinicio' };
        }
        const m = await stream.finalMessage();
        conferir(m);
        yield { tipo: 'fim', resposta: resposta(m, texto(m), inicio) };
      } catch (e) {
        traduzir(e);
      }
    },
  };
}

/** Recusa e corte antes de ler o conteúdo. */
function conferir(m: Mensagem): void {
  const gasto = { uso: uso(m.usage), modelo: m.model };
  if (m.stop_reason === 'refusal') throw new ErroIA('ia.recusa', { categoria: m.stop_details?.category ?? null, ...gasto });
  if (m.stop_reason === 'max_tokens' || m.stop_reason === 'model_context_window_exceeded') throw new ErroIA('ia.limite_tokens', gasto);
}

function jsonOuNada(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** O texto da resposta: só o que veio depois do último bloco de fallback (o modelo que recusou fica de fora). */
function texto(m: Mensagem): string {
  const ultimoFallback = m.content.findLastIndex((b) => b.type === 'fallback');
  return m.content
    .slice(ultimoFallback + 1)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('');
}

const uso = (u: Mensagem['usage']): UsoIA => ({
  entrada: u.input_tokens,
  saida: u.output_tokens,
  cacheLeitura: u.cache_read_input_tokens ?? 0,
  cacheEscrita: u.cache_creation_input_tokens ?? 0,
});

/** Erros do SDK → ErroIA, do mais específico ao mais geral. A mensagem do provedor não é copiada. */
function traduzir(e: unknown): never {
  if (e instanceof ErroIA) throw e;
  if (e instanceof Anthropic.APIUserAbortError) throw new ErroIA('ia.cancelada');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ErroIA('ia.autenticacao', { status: e.status });
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) throw new ErroIA('ia.indisponivel', { status: e.status });
  // Rede e tempo esgotado (APIConnectionTimeoutError é subclasse): antes do APIError, que é a base.
  if (e instanceof Anthropic.APIConnectionError) throw new ErroIA('ia.indisponivel');
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === 'number' ? e.status : undefined;
    // Sem status: erro enviado no meio do stream (overloaded_error, api_error), temporário.
    if (status === undefined || status >= 500 || status === 408 || status === 409) throw new ErroIA('ia.indisponivel', status === undefined ? {} : { status });
    throw new ErroIA('ia.requisicao_invalida', { status });
  }
  // Qualquer outra falha (resposta ilegível, erro do SDK): sem copiar a mensagem, que pode trazer
  // trecho da resposta do provedor.
  throw new ErroIA('ia.indisponivel');
}
