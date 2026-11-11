import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarProvedorAnthropic } from './anthropic';
import { apiFalsa, type CenarioApi } from './api-falsa.test-util';
import { ErroIA, type PedidoIA } from './porta';
import { criarProvedorIA } from './provedor';

// O adaptador Anthropic sem rede (a API simulada no fetch do SDK): o pedido que sai, as novas
// tentativas e a tradução dos erros (US-018, spec §4.4).
const pedido: PedidoIA = { instrucaoSistema: 'Você sugere contas.', mensagem: 'Material de escritório' };

function provedor(cenarios: CenarioApi[], novasTentativas = 2) {
  const api = apiFalsa(cenarios);
  return { api, ia: criarProvedorAnthropic({ apiKey: 'chave-de-teste', fetch: api.fetch, novasTentativas }) };
}

async function erro(p: Promise<unknown>): Promise<ErroIA> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroIA) return e;
    throw e;
  }
  throw new Error('esperava ErroIA');
}

describe('criarProvedorAnthropic', () => {
  it('o pedido: modelo, adaptive thinking, esforço, cache no prefixo e fallback do servidor', async () => {
    const { api, ia } = provedor([{ texto: 'ok' }]);
    await ia.gerarTexto({ ...pedido, esforco: 'high', maxTokens: 2000 });
    const [r] = api.requisicoes;
    expect(r!.corpo).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      system: [{ type: 'text', text: 'Você sugere contas.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Material de escritório' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      fallbacks: 'default',
    });
    expect(r!.cabecalhos.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(r!.cabecalhos.get('authorization')).toBe('Bearer chave-de-teste'); // o SDK 1.x envia a chave assim
  });

  it('esforço padrão "medium" e o schema da saída estruturada no output_config', async () => {
    const { api, ia } = provedor([{ texto: '{"conta":"4.1"}' }]);
    await ia.gerarEstruturado(pedido, z.object({ conta: z.string() }));
    const config = api.requisicoes[0]!.corpo.output_config as { effort: string; format: { type: string; schema: { properties: object } } };
    expect(config.effort).toBe('medium');
    expect(config.format.type).toBe('json_schema');
    expect(Object.keys(config.format.schema.properties)).toEqual(['conta']);
  });

  it('o texto ignora os blocos de thinking e de fallback; o modelo é o que respondeu', async () => {
    const { ia } = provedor([
      { texto: 'resposta', modelo: 'claude-opus-4-8', antes: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }] },
    ]);
    const r = await ia.gerarTexto(pedido);
    expect(r.valor).toBe('resposta');
    expect(r.modelo).toBe('claude-opus-4-8');
    expect(r.uso).toEqual({ entrada: 120, saida: 30, cacheLeitura: 100, cacheEscrita: 0 });
  });

  it('429 e 500: nova tentativa, e na segunda vem a resposta', async () => {
    const { api, ia } = provedor([{ texto: '', status: 429 }, { texto: '', status: 500 }, { texto: 'ok' }]);
    expect((await ia.gerarTexto(pedido)).valor).toBe('ok');
    expect(api.requisicoes).toHaveLength(3);
  });

  it('erro temporário depois das novas tentativas: ia.indisponivel, temporário', async () => {
    const { api, ia } = provedor([{ texto: '', status: 529 }], 2);
    const e = await erro(ia.gerarTexto(pedido));
    expect([e.codigo, e.temporario, e.detalhes.status]).toEqual(['ia.indisponivel', true, 529]);
    expect(api.requisicoes).toHaveLength(3);
  });

  it('400 e 401: sem nova tentativa', async () => {
    const a = provedor([{ texto: '', status: 400 }]);
    expect((await erro(a.ia.gerarTexto(pedido))).codigo).toBe('ia.requisicao_invalida');
    expect(a.api.requisicoes).toHaveLength(1);
    const b = provedor([{ texto: '', status: 401 }]);
    const e = await erro(b.ia.gerarTexto(pedido));
    expect([e.codigo, e.temporario]).toEqual(['ia.autenticacao', false]);
    expect(b.api.requisicoes).toHaveLength(1);
  });

  it('recusa: a categoria vai no erro, e a mensagem não traz o texto do provedor', async () => {
    const { ia } = provedor([{ texto: '', motivo: 'refusal', categoria: 'cyber' }]);
    const e = await erro(ia.gerarTexto(pedido));
    expect([e.codigo, e.detalhes.categoria, e.message]).toEqual(['ia.recusa', 'cyber', 'A IA recusou o pedido.']);
  });

  it('estruturado cortado: ia.limite_tokens (não saída inválida)', async () => {
    const { ia } = provedor([{ texto: '{"conta":"4.', motivo: 'max_tokens' }]);
    expect((await erro(ia.gerarEstruturado(pedido, z.object({ conta: z.string() })))).codigo).toBe('ia.limite_tokens');
  });

  it('stream: pede stream e entrega os pedaços', async () => {
    const { api, ia } = provedor([{ texto: 'abcdefghij' }]);
    const pedacos: string[] = [];
    for await (const e of ia.gerarStream(pedido)) if (e.tipo === 'texto') pedacos.push(e.texto);
    expect(pedacos).toEqual(['abcde', 'fghij']);
    expect(api.requisicoes[0]!.corpo.stream).toBe(true);
  });

  it('stream cancelado no meio: ia.cancelada', async () => {
    const { ia } = provedor([{ texto: 'abcdefghijklmno' }]);
    const controle = new AbortController();
    const consumir = (async () => {
      for await (const e of ia.gerarStream({ ...pedido, sinal: controle.signal })) if (e.tipo === 'texto') controle.abort();
    })();
    expect((await erro(consumir)).codigo).toBe('ia.cancelada');
  });

  it('erro no meio do stream (overloaded_error): ia.indisponivel, temporário', async () => {
    const { ia } = provedor([{ texto: 'abcdefghij', erroNoStream: 'overloaded_error' }]);
    const consumir = (async () => {
      for await (const _ of ia.gerarStream(pedido)) void _;
    })();
    const e = await erro(consumir);
    expect([e.codigo, e.temporario]).toEqual(['ia.indisponivel', true]);
    // O uso já informado no message_start vai no erro, para o registro do custo.
    expect(e.detalhes.uso?.entrada).toBe(120);
    expect(e.detalhes.modelo).toBe('claude-opus-5-5');
  });

  it('resposta ilegível: ia.indisponivel, sem copiar o corpo na mensagem', async () => {
    const { ia } = provedor([{ texto: '', corpoInvalido: true }]);
    const e = await erro(ia.gerarTexto(pedido));
    expect(e.codigo).toBe('ia.indisponivel');
    expect(e.message).not.toContain('trecho');
  });

  it('fallback no meio: o texto do modelo que recusou fica fora; no stream, um "reinicio" antes do texto novo', async () => {
    const antes = [
      { type: 'text', text: 'parcial do primeiro ' },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
    ];
    const a = provedor([{ texto: 'resposta final', modelo: 'claude-opus-4-8', antes }]);
    expect((await a.ia.gerarTexto(pedido)).valor).toBe('resposta final');
    const b = provedor([{ texto: 'resposta final', modelo: 'claude-opus-4-8', antes }]);
    const tipos: string[] = [];
    let fim = '';
    for await (const e of b.ia.gerarStream(pedido)) {
      tipos.push(e.tipo === 'texto' ? `texto:${e.texto}` : e.tipo);
      if (e.tipo === 'fim') fim = e.resposta.valor;
    }
    expect(tipos.indexOf('reinicio')).toBeGreaterThan(0);
    expect(tipos.slice(tipos.indexOf('reinicio') + 1, -1).map((t) => t.slice(6)).join('')).toBe('resposta final');
    expect(fim).toBe('resposta final');
  });

  it('chave vazia: ia.desabilitada, sem criar o cliente', () => {
    expect(() => criarProvedorAnthropic({ apiKey: '  ' })).toThrow(ErroIA);
  });
});

describe('criarProvedorIA', () => {
  it('sem chave no dev: o falso; em produção sem chave: ia.desabilitada', async () => {
    expect((await criarProvedorIA({ NODE_ENV: 'development' }).gerarTexto(pedido)).valor).toMatch(/^Resposta de teste/);
    const prod = criarProvedorIA({ NODE_ENV: 'production', ANTHROPIC_API_KEY: '  ' });
    expect((await erro(prod.gerarTexto(pedido))).codigo).toBe('ia.desabilitada');
    expect((await erro(prod.gerarEstruturado(pedido, z.object({})))).codigo).toBe('ia.desabilitada');
    const stream = (async () => {
      for await (const _ of prod.gerarStream(pedido)) void _;
    })();
    expect((await erro(stream)).codigo).toBe('ia.desabilitada');
  });
});
