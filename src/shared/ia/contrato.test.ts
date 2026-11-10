import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarProvedorAnthropic } from './anthropic';
import { criarProvedorIAFalso } from './falso';
import { ErroIA, type EventoStreamIA, type PedidoIA, type ProvedorIA } from './porta';
import { apiFalsa, type CenarioApi } from './api-falsa.test-util';

// Testes de contrato da porta ProvedorIA (US-018): o mesmo comportamento no adaptador falso e no
// Anthropic (este com a API simulada no fetch do SDK, sem rede).
type Cenario = { texto: string } | { estruturado: unknown } | { recusa: true } | { cortada: true };

const IMPLEMENTACOES: [string, (c: Cenario) => ProvedorIA][] = [
  [
    'falso',
    (c) =>
      'texto' in c
        ? criarProvedorIAFalso({ texto: c.texto, pedaco: 3 })
        : 'estruturado' in c
          ? criarProvedorIAFalso({ estruturado: c.estruturado })
          : criarProvedorIAFalso({ erro: 'recusa' in c ? 'ia.recusa' : 'ia.limite_tokens' }),
  ],
  [
    'anthropic',
    (c) => {
      const cenario: CenarioApi =
        'texto' in c
          ? { texto: c.texto }
          : 'estruturado' in c
            ? { texto: JSON.stringify(c.estruturado) }
            : { texto: '', motivo: 'recusa' in c ? 'refusal' : 'max_tokens' };
      return criarProvedorAnthropic({ apiKey: 'chave-de-teste', fetch: apiFalsa([cenario]).fetch, novasTentativas: 0 });
    },
  ],
];

const pedido: PedidoIA = { instrucaoSistema: 'Você sugere contas.', mensagem: 'Material de escritório' };
const Sugestao = z.object({ conta: z.string(), confianca: z.number().min(0).max(1) });

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem erro';
  } catch (e) {
    expect(e).toBeInstanceOf(ErroIA);
    return (e as ErroIA).codigo;
  }
}

async function eventos(s: AsyncIterable<EventoStreamIA>): Promise<EventoStreamIA[]> {
  const lista: EventoStreamIA[] = [];
  for await (const e of s) lista.push(e);
  return lista;
}

describe.each(IMPLEMENTACOES)('contrato da porta ProvedorIA (%s)', (_nome, criar) => {
  it('gerarTexto: o texto, o modelo e o uso', async () => {
    const r = await criar({ texto: 'Use a conta 4.1.1.2.003.' }).gerarTexto(pedido);
    expect(r.valor).toBe('Use a conta 4.1.1.2.003.');
    expect(r.modelo).toBe('claude-opus-5-5');
    expect(r.motivoParada).toBe('end_turn');
    expect(r.uso.entrada).toBeGreaterThan(0);
  });

  it('gerarEstruturado: o objeto validado pelo schema', async () => {
    const r = await criar({ estruturado: { conta: '4.1.1.2.003', confianca: 0.8 } }).gerarEstruturado(pedido, Sugestao);
    expect(r.valor).toEqual({ conta: '4.1.1.2.003', confianca: 0.8 });
  });

  it('gerarEstruturado fora do schema: ia.saida_invalida', async () => {
    expect(await codigo(criar({ estruturado: { conta: 1 } }).gerarEstruturado(pedido, Sugestao))).toBe('ia.saida_invalida');
  });

  it('gerarStream: os pedaços somam o texto, e o último evento é o fim com a resposta inteira', async () => {
    const lista = await eventos(criar({ texto: 'Resposta longa da IA.' }).gerarStream(pedido));
    const fim = lista.at(-1);
    expect(fim?.tipo).toBe('fim');
    expect(fim?.tipo === 'fim' && fim.resposta.valor).toBe('Resposta longa da IA.');
    const pedacos = lista.flatMap((e) => (e.tipo === 'texto' ? [e.texto] : []));
    expect(pedacos.join('')).toBe('Resposta longa da IA.');
  });

  it('recusa: ia.recusa, sem conteúdo', async () => {
    expect(await codigo(criar({ recusa: true }).gerarTexto(pedido))).toBe('ia.recusa');
    expect(await codigo(eventos(criar({ recusa: true }).gerarStream(pedido)))).toBe('ia.recusa');
  });

  it('resposta cortada: ia.limite_tokens', async () => {
    expect(await codigo(criar({ cortada: true }).gerarTexto(pedido))).toBe('ia.limite_tokens');
  });

  it('pedido já cancelado: ia.cancelada', async () => {
    const sinal = AbortSignal.abort();
    expect(await codigo(criar({ texto: 'x' }).gerarTexto({ ...pedido, sinal }))).toBe('ia.cancelada');
  });
});
