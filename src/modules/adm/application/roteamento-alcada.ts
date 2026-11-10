import type { TxCliente } from '@/shared/db';
import type { FluxoAprovacao } from '../domain/alcada';

export type AprovadorResolvido = { usuarioId: string; papel: 'TITULAR' | 'SUBSTITUTO' } | { bloqueio: 'MESMO_USUARIO' } | null;

// Roteamento da alçada (RN_ALC_005, §11.4), para os fluxos de aprovação (US-078): o titular se
// ativo e desbloqueado; senão, o substituto nas mesmas condições; sem nenhum, null (o consumidor mostra SEM_APROVADOR e
// desabilita a submissão). Sem seleção manual de aprovador (§6.5). Quem submete não aprova o
// próprio pedido (RN_WA02_006): se o escolhido for o solicitante, bloqueia em vez de redirecionar
// (UC6.02 E4). Pelo servidor.ts: não exige permissão (quem chama é o caso de uso que submete).
export async function resolverAprovador(tx: TxCliente, fluxo: FluxoAprovacao, opcoes: { solicitanteId?: string } = {}): Promise<AprovadorResolvido> {
  const alcada = await tx.alcadaAprovacao.findFirst({
    where: { fluxo, ativa: true },
    select: { titular: { select: { id: true, ativo: true, bloqueado: true } }, substituto: { select: { id: true, ativo: true, bloqueado: true } } },
  });
  if (!alcada) return null;
  // Bloqueado (tentativas de acesso) não consegue entrar para aprovar: conta como indisponível.
  const disponivel = (u: { ativo: boolean; bloqueado: boolean }) => u.ativo && !u.bloqueado;
  const escolhido = disponivel(alcada.titular)
    ? { usuarioId: alcada.titular.id, papel: 'TITULAR' as const }
    : disponivel(alcada.substituto)
      ? { usuarioId: alcada.substituto.id, papel: 'SUBSTITUTO' as const }
      : null;
  if (escolhido && escolhido.usuarioId === opcoes.solicitanteId) return { bloqueio: 'MESMO_USUARIO' };
  return escolhido;
}
