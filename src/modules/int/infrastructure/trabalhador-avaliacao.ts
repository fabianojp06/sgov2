import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import { ErroIA, FILA_AVALIACAO_IA, MINUTOS_AVALIACAO_IA, MINUTOS_AVALIACAO_VENCIDA, type AvaliadorCasoIA } from '@/shared/ia';

// Trabalhador da fila ia.avaliar (US-019; pedido da frente A na #138): roda o avaliador que o módulo
// dono registrou para o caso e grava o resultado em ia_avaliacao. Uma execução só: antes de chamar a IA,
// o worker toma a avaliação (iniciado_em, condicionado à PENDENTE ainda não tomada e não vencida); um job
// repetido, um reenvio do pg-boss ou um segundo worker não a tomam de novo. O resultado só é gravado
// sobre a PENDENTE, e o trigger do banco impede reescrever uma concluída. Sem server-only: roda no worker.

export const MSG_SEM_AVALIADOR = 'Este caso de uso não tem avaliador registrado no worker.';
export const MSG_FALHA_AVALIACAO = 'A avaliação falhou. Tente de novo mais tarde.';
export const MSG_RESULTADO_INVALIDO = 'O avaliador devolveu um resultado inválido.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES_RESUMO = 8_000;

// Resumo só numérico (LGPD: nada de texto de usuário), com chaves curtas e tamanho limitado.
const chave = z.string().min(1).max(60);
const esquemaResultado = z.object({
  total: z.number().int().min(0),
  acertos: z.number().int().min(0),
  resumo: z.record(chave, z.union([z.number().finite(), z.record(chave, z.number().finite())])).optional(),
});

export type DepsAvaliacao = { cliente: PrismaClient; avaliadores: Readonly<Record<string, AvaliadorCasoIA>> };

export function criarTrabalhadorAvaliacao(deps: DepsAvaliacao) {
  const { cliente } = deps;
  return async (dados: unknown): Promise<void> => {
    const id = (dados as { avaliacaoId?: unknown } | null)?.avaliacaoId;
    if (typeof id !== 'string' || !UUID.test(id)) return;
    // Toma a avaliação: só a PENDENTE, ainda não tomada e não vencida. Nenhuma linha: nada a fazer.
    const [tomada] = await cliente.$queryRaw<{ caso_uso_codigo: string; usuario_id: string }[]>`
      UPDATE "ia_avaliacao" SET "iniciado_em" = clock_timestamp()
      WHERE "id" = ${id}::uuid AND "situacao" = 'PENDENTE' AND "iniciado_em" IS NULL
        AND "criado_em" > clock_timestamp() - make_interval(mins => ${MINUTOS_AVALIACAO_VENCIDA})
      RETURNING "caso_uso_codigo", "usuario_id"`;
    if (!tomada) return;
    const caso = tomada.caso_uso_codigo;
    const gravar = (data: { situacao: 'CONCLUIDA' | 'FALHOU'; total?: number; acertos?: number; resumo?: object; erro?: string }) =>
      cliente.iaAvaliacao.updateMany({ where: { id, situacao: 'PENDENTE' }, data: { ...data, concluidoEm: new Date() } });
    const avaliador = Object.hasOwn(deps.avaliadores, caso) ? deps.avaliadores[caso] : undefined;
    if (!avaliador) {
      await gravar({ situacao: 'FALHOU', erro: MSG_SEM_AVALIADOR });
      return;
    }
    try {
      const bruto = await avaliador({ avaliacaoId: id, casoUsoCodigo: caso, usuarioId: tomada.usuario_id, sinal: AbortSignal.timeout(MINUTOS_AVALIACAO_IA * 60_000) });
      const r = esquemaResultado.safeParse(bruto);
      const resumo = r.success ? (r.data.resumo ?? {}) : null;
      if (!r.success || r.data.acertos > r.data.total || JSON.stringify(resumo).length > MAX_BYTES_RESUMO) {
        await gravar({ situacao: 'FALHOU', erro: MSG_RESULTADO_INVALIDO });
        return;
      }
      await gravar({ situacao: 'CONCLUIDA', total: r.data.total, acertos: r.data.acertos, resumo: resumo! });
    } catch (e) {
      // A mensagem do ErroIA é fixa e serve à tela; outra falha não vai para a tela (pode ter dado).
      console.error('[IA_AVALIACAO_FALHOU]', { caso, erro: e instanceof Error ? e.name : typeof e });
      await gravar({ situacao: 'FALHOU', erro: e instanceof ErroIA ? e.message : MSG_FALHA_AVALIACAO });
    }
  };
}

/** Registra o trabalhador da fila ia.avaliar no worker, com os avaliadores entregues pelos módulos. */
export async function registrarTrabalhadoresInt(fila: FilaGerenciada, deps: DepsAvaliacao): Promise<void> {
  await fila.registrarTrabalhador(FILA_AVALIACAO_IA, criarTrabalhadorAvaliacao(deps));
}
