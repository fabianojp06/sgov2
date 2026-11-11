import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import { ErroIA, FILA_AVALIACAO_IA, type AvaliadorCasoIA } from '@/shared/ia';

// Trabalhador da fila ia.avaliar (US-019; pedido da frente A na #138): roda o avaliador que o módulo
// dono registrou para o caso e grava o resultado em ia_avaliacao. Uma tentativa só: avaliar custa
// chamadas de IA, e o erro fica na tela para o Administrador pedir de novo. Sem server-only: roda no worker.

export const MSG_SEM_AVALIADOR = 'Este caso de uso não tem avaliador registrado no worker.';
export const MSG_FALHA_AVALIACAO = 'A avaliação falhou. Tente de novo mais tarde.';
const MSG_RESULTADO_INVALIDO = 'O avaliador devolveu um resultado inválido.';

export type DepsAvaliacao = { cliente: PrismaClient; avaliadores: Readonly<Record<string, AvaliadorCasoIA>> };

export function criarTrabalhadorAvaliacao(deps: DepsAvaliacao) {
  return async (dados: unknown): Promise<void> => {
    const id = (dados as { avaliacaoId?: unknown } | null)?.avaliacaoId;
    if (typeof id !== 'string') return;
    const a = await deps.cliente.iaAvaliacao.findUnique({ where: { id } });
    // Job repetido ou avaliação já resolvida: nada a fazer.
    if (!a || a.situacao !== 'PENDENTE') return;
    const falhar = (erro: string) =>
      deps.cliente.iaAvaliacao.update({ where: { id }, data: { situacao: 'FALHOU', erro, concluidoEm: new Date() } });
    const avaliador = Object.hasOwn(deps.avaliadores, a.casoUsoCodigo) ? deps.avaliadores[a.casoUsoCodigo] : undefined;
    if (!avaliador) {
      await falhar(MSG_SEM_AVALIADOR);
      return;
    }
    try {
      const r = await avaliador({ avaliacaoId: id, casoUsoCodigo: a.casoUsoCodigo, usuarioId: a.usuarioId });
      if (!Number.isInteger(r.total) || !Number.isInteger(r.acertos) || r.total < 0 || r.acertos < 0 || r.acertos > r.total) {
        await falhar(MSG_RESULTADO_INVALIDO);
        return;
      }
      await deps.cliente.iaAvaliacao.update({
        where: { id },
        data: { situacao: 'CONCLUIDA', total: r.total, acertos: r.acertos, resumo: (r.resumo ?? {}) as object, concluidoEm: new Date() },
      });
    } catch (e) {
      // A mensagem do ErroIA é fixa e serve à tela; outra falha não vai para a tela (pode ter dado).
      console.error('[IA_AVALIACAO_FALHOU]', { caso: a.casoUsoCodigo, erro: e instanceof Error ? e.name : typeof e });
      await falhar(e instanceof ErroIA ? e.message : MSG_FALHA_AVALIACAO);
    }
  };
}

/** Registra o trabalhador da fila ia.avaliar no worker, com os avaliadores entregues pelos módulos. */
export async function registrarTrabalhadoresInt(fila: FilaGerenciada, deps: DepsAvaliacao): Promise<void> {
  await fila.registrarTrabalhador(FILA_AVALIACAO_IA, criarTrabalhadorAvaliacao(deps));
}
