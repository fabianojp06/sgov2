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
 * O botão de IA aparece? (D-P14-5): servicoIA.disponivel (#390) confere a permissão do caso, a chave
 * geral, o caso ativo e os tetos, sem reservar nem registrar. O orc nunca lê as tabelas ia_*.
 */
export function iaLiberada(ctx: ContextoRequisicao, caso: keyof typeof CASOS_IA_ORC, deps: Partial<Pick<DepsIaOrc, 'ia'>> = {}): Promise<boolean> {
  return (deps.ia ?? servicoIA).disponivel(ctx, CASOS_IA_ORC[caso]);
}

// Ficam no ia-erros.ts, sem dependências de tela, para o revisor no worker usar também.
export { mensagemErroIA, tempoEsgotado } from './ia-erros';
