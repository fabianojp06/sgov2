import type { ContextoRequisicao } from '@/shared/authz';
import { servicoIA, type ServicoIA } from '@/shared/ia';
import { resolverDeps, type DepsOrc } from './deps';
import { CASOS_IA_ORC } from './ia-casos';

// Dependências dos casos de uso com IA: as do orc, o serviço de IA (com a governança) e o tempo
// limite da chamada interativa (D-P14-4). Os testes trocam o serviço por um com o provedor falso.
export const TEMPO_LIMITE_IA_MS = 30_000;
export type DepsIaOrc = DepsOrc & { ia: ServicoIA; sinalIa: () => AbortSignal };

export function resolverDepsIa(deps: Partial<DepsIaOrc> = {}): DepsIaOrc {
  return { ...resolverDeps(deps), ia: deps.ia ?? servicoIA, sinalIa: deps.sinalIa ?? (() => AbortSignal.timeout(TEMPO_LIMITE_IA_MS)) };
}

/**
 * O botão de IA aparece? (D-P14-5). Por ora, só a permissão do caso; o servicoIA recusa com a
 * mensagem do ErroIA quando a IA está desligada. Quando o servicoIA.disponivel (#390) chegar à main,
 * a troca é só aqui. O orc nunca lê as tabelas ia_*.
 */
export async function iaLiberada(ctx: ContextoRequisicao, caso: keyof typeof CASOS_IA_ORC): Promise<boolean> {
  return ctx.permissoes.has(`${CASOS_IA_ORC[caso].funcionalidade}:executar`);
}
