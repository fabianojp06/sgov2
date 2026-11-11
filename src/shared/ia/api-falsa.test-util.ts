// API de mensagens simulada no fetch do SDK, para os testes do adaptador Anthropic sem rede. Cada
// chamada consome o próximo cenário (o último se repete) e responde em JSON ou, quando o pedido é
// de stream, em SSE. As requisições ficam gravadas (corpo e cabeçalhos) para os testes conferirem.

export type CenarioApi = {
  texto: string;
  /** stop_reason (padrão end_turn). */
  motivo?: string;
  categoria?: string | null;
  /** HTTP de erro (429, 500, 400...): responde só o erro. */
  status?: number;
  /** Blocos antes do texto (thinking, fallback e o texto do modelo que recusou), como a API os devolve. */
  antes?: object[];
  modelo?: string;
  /** Corpo que não é JSON, com status 200. */
  corpoInvalido?: boolean;
  /** Evento de erro no meio do stream, depois do primeiro pedaço (ex.: overloaded_error). */
  erroNoStream?: string;
};

export type RequisicaoGravada = { corpo: Record<string, unknown>; cabecalhos: Headers };

export function apiFalsa(cenarios: CenarioApi[]) {
  const requisicoes: RequisicaoGravada[] = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw new DOMException('A operação foi cancelada.', 'AbortError');
    requisicoes.push({ corpo: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, cabecalhos: new Headers(init?.headers) });
    const c = cenarios[Math.min(requisicoes.length - 1, cenarios.length - 1)]!;
    if (c.status) {
      return Response.json(
        { type: 'error', error: { type: c.status === 429 ? 'rate_limit_error' : 'api_error', message: 'erro simulado' } },
        // 1 ms: o SDK ignora 0 e esperaria 0,5 s a 1 s.
        { status: c.status, headers: { 'retry-after-ms': '1' } },
      );
    }
    if (c.corpoInvalido) return new Response('trecho da resposta do provedor', { headers: { 'content-type': 'application/json' } });
    const mensagem = {
      id: `msg_${requisicoes.length}`,
      type: 'message',
      role: 'assistant',
      model: c.modelo ?? 'claude-opus-5-5',
      content: [...(c.antes ?? []), ...(c.texto ? [{ type: 'text', text: c.texto }] : [])],
      stop_reason: c.motivo ?? 'end_turn',
      stop_sequence: null,
      stop_details: c.motivo === 'refusal' ? { type: 'refusal', category: c.categoria ?? null, explanation: null } : null,
      usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    };
    const corpo = requisicoes.at(-1)!.corpo;
    if (corpo.stream !== true) return Response.json(mensagem);
    return new Response(sse(mensagem, c.erroNoStream), { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requisicoes };
}

function sse(m: { content: unknown[]; stop_reason: string; stop_details: unknown; usage: object }, erro?: string): string {
  const eventos: [string, object][] = [['message_start', { type: 'message_start', message: { ...m, content: [], stop_reason: null, stop_details: null } }]];
  const texto = () => eventos.map(([nome, dados]) => `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`).join('');
  (m.content as { type: string; text?: string }[]).forEach((bloco, index) => {
    if (bloco.type !== 'text') {
      eventos.push(['content_block_start', { type: 'content_block_start', index, content_block: bloco }], ['content_block_stop', { type: 'content_block_stop', index }]);
      return;
    }
    eventos.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
    for (let i = 0; i < bloco.text!.length; i += 5) {
      eventos.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: bloco.text!.slice(i, i + 5) } }]);
      if (erro) eventos.push(['error', { type: 'error', error: { type: erro, message: 'erro simulado' } }]);
    }
    eventos.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  if (erro) return texto();
  eventos.push(['message_delta', { type: 'message_delta', delta: { stop_reason: m.stop_reason, stop_sequence: null, stop_details: m.stop_details }, usage: { output_tokens: 30 } }]);
  eventos.push(['message_stop', { type: 'message_stop' }]);
  return texto();
}
