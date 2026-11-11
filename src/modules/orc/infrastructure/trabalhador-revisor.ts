import { z } from 'zod';
import type { FilaGerenciada } from '@/shared/filas';
import { FILA_REVISAO, processarRevisao, type DepsRevisor } from '../application/revisor-processamento';

// Trabalhador da fila orc.revisar (US-064; plano do P14, D-P14-6): o job leva só o id da revisão; o
// resto é lido do banco na hora. Pedido fora do formato não volta para a fila (tentar de novo não
// adianta). Erro que sobe do processamento (nem o FALHOU pôde ser gravado) volta para a fila, e a nova
// tentativa só processa a revisão se ela ainda estiver PENDENTE.
const PEDIDO = z.object({ revisaoId: z.string() });

export function criarTrabalhadorRevisor(deps: Partial<DepsRevisor> & Pick<DepsRevisor, 'cliente'>) {
  return async (dados: unknown): Promise<void> => {
    const pedido = PEDIDO.safeParse(dados);
    if (!pedido.success) {
      console.error('[ORC_REVISAO_PEDIDO_INVALIDO]');
      return;
    }
    await processarRevisao(pedido.data.revisaoId, deps);
  };
}

export async function registrarTrabalhadorRevisor(fila: FilaGerenciada, deps: Partial<DepsRevisor> & Pick<DepsRevisor, 'cliente'>): Promise<void> {
  await fila.registrarTrabalhador(FILA_REVISAO, criarTrabalhadorRevisor(deps));
}
