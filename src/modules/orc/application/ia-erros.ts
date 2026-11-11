import type { ErroIA } from '@/shared/ia';
import { MENSAGENS_ORC } from '../domain/mensagens';

// Erros da IA no orc (plano do P14, D-P14-4). Sem dependências de tela nem de autorização: o
// revisor (US-064) usa no worker.

// Tempo limite da chamada (D-P14-4): o sinal abortou pelo AbortSignal.timeout.
export const tempoEsgotado = (sinal: AbortSignal) => sinal.aborted && (sinal.reason as { name?: unknown } | undefined)?.name === 'TimeoutError';

/** A mensagem do ErroIA na tela: a fixa dele, ou a do tempo esgotado quando o cancelamento veio do limite. */
export const mensagemErroIA = (x: ErroIA, sinal: AbortSignal): string => (x.codigo === 'ia.cancelada' && tempoEsgotado(sinal) ? MENSAGENS_ORC.IA_TEMPO_ESGOTADO : x.message);
