import type { z } from 'zod';
import { ErroIA, MODELO_PADRAO, type CodigoErroIA, type EventoStreamIA, type PedidoIA, type ProvedorIA, type RespostaIA } from './porta';

// Adaptador falso da porta ProvedorIA (spec §4.4, US-018): para os testes e para o dev sem chave.
// Determinístico e sem rede. Por padrão, o texto ecoa o tamanho do pedido; o roteiro fixa a
// resposta (texto, objeto estruturado ou erro). As chamadas ficam em `chamadas`, para os testes
// conferirem o que foi enviado (minimização de dados).

export type RoteiroIAFalso = {
  texto?: string;
  estruturado?: unknown;
  erro?: CodigoErroIA;
  /** Tamanho dos pedaços do stream (padrão 8 caracteres). */
  pedaco?: number;
};

export type ProvedorIAFalso = ProvedorIA & { chamadas: PedidoIA[]; roteiro: RoteiroIAFalso };

export function criarProvedorIAFalso(roteiro: RoteiroIAFalso = {}): ProvedorIAFalso {
  const chamadas: PedidoIA[] = [];
  const responder = <T>(p: PedidoIA, valor: T): RespostaIA<T> => ({
    valor,
    modelo: p.modelo ?? MODELO_PADRAO,
    uso: { entrada: p.instrucaoSistema.length + p.mensagem.length, saida: JSON.stringify(valor).length, cacheLeitura: 0, cacheEscrita: 0 },
    motivoParada: 'end_turn',
    latenciaMs: 0,
  });
  const entrar = (p: PedidoIA) => {
    chamadas.push(p);
    if (p.sinal?.aborted) throw new ErroIA('ia.cancelada');
    if (provedor.roteiro.erro) throw new ErroIA(provedor.roteiro.erro);
  };
  const textoDe = (p: PedidoIA) => provedor.roteiro.texto ?? `Resposta de teste (${p.mensagem.length} caracteres).`;

  const provedor: ProvedorIAFalso = {
    chamadas,
    roteiro,
    async gerarTexto(p) {
      entrar(p);
      return responder(p, textoDe(p));
    },
    async gerarEstruturado<S extends z.ZodType>(p: PedidoIA, schema: S): Promise<RespostaIA<z.infer<S>>> {
      entrar(p);
      const lido = schema.safeParse(provedor.roteiro.estruturado);
      if (!lido.success) throw new ErroIA('ia.saida_invalida');
      return responder(p, lido.data as z.infer<S>);
    },
    async *gerarStream(p): AsyncGenerator<EventoStreamIA> {
      entrar(p);
      const texto = textoDe(p);
      const n = provedor.roteiro.pedaco ?? 8;
      for (let i = 0; i < texto.length; i += n) yield { tipo: 'texto', texto: texto.slice(i, i + n) };
      yield { tipo: 'fim', resposta: responder(p, texto) };
    },
  };
  return provedor;
}
