import { criarProvedorAnthropic } from './anthropic';
import { criarProvedorIAFalso } from './falso';
import { ErroIA, type ProvedorIA } from './porta';

/**
 * O provedor do ambiente: com ANTHROPIC_API_KEY (só nas variáveis do Easypanel), o Anthropic; sem
 * ela, o falso no dev e nos testes. Em produção sem chave, um provedor que recusa tudo com
 * ia.desabilitada: resposta falsa nunca chega a um usuário real.
 */
export function criarProvedorIA(env: Readonly<Record<string, string | undefined>> = process.env): ProvedorIA {
  const chave = env.ANTHROPIC_API_KEY?.trim();
  if (chave) return criarProvedorAnthropic({ apiKey: chave });
  if (env.NODE_ENV === 'production') return provedorDesabilitado;
  return criarProvedorIAFalso();
}

const desabilitada = (): never => {
  throw new ErroIA('ia.desabilitada');
};

const provedorDesabilitado: ProvedorIA = {
  gerarTexto: async () => desabilitada(),
  gerarEstruturado: async () => desabilitada(),
  // eslint-disable-next-line require-yield -- recusa antes do primeiro evento
  async *gerarStream() {
    desabilitada();
  },
};
