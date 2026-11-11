import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/shared/db';

// Saúde do sistema (US-017): o banco responde e o worker deu sinal de vida há pouco. Para o endpoint
// público /int/saude, que um monitor externo consulta para alertar por e-mail. A resposta diz só qual
// componente falhou: nada de versão, dado ou mensagem de erro.

/** Sinal de vida mais velho que isto: worker parado (o ciclo do outbox é de 10 s). */
export const SEGUNDOS_WORKER_PARADO = 60;
/** Tempo máximo da consulta ao banco: um banco travado responde como fora. */
export const MS_LIMITE_BANCO = 2000;

export type EstadoSaude = {
  status: 'ok' | 'falha';
  banco: 'ok' | 'falha';
  worker: 'ok' | 'parado' | 'desconhecido';
};

type Deps = { cliente?: PrismaClient; limiteMs?: number };

export async function verificarSaude(deps: Deps = {}): Promise<EstadoSaude> {
  const cliente = deps.cliente ?? prisma;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const consulta = cliente.$queryRaw<{ idade: number | null }[]>`
      SELECT (SELECT EXTRACT(EPOCH FROM clock_timestamp() - "atualizado_em")::float8 FROM "sinal_vida" WHERE "componente" = 'worker') AS "idade"`;
    const limite = new Promise<never>((_, rejeitar) => {
      temporizador = setTimeout(() => rejeitar(new Error('tempo esgotado')), deps.limiteMs ?? MS_LIMITE_BANCO);
    });
    const [linha] = await Promise.race([consulta, limite]);
    const idade = linha?.idade ?? null;
    const worker = idade !== null && idade <= SEGUNDOS_WORKER_PARADO ? 'ok' : 'parado';
    return { status: worker === 'ok' ? 'ok' : 'falha', banco: 'ok', worker };
  } catch (e) {
    console.error('[SAUDE_BANCO_FALHOU]', e instanceof Error ? e.name : typeof e);
    return { status: 'falha', banco: 'falha', worker: 'desconhecido' };
  } finally {
    clearTimeout(temporizador);
  }
}
