import type { PrismaClient } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';
import type { Fila, NomeFila } from './fila';

// Grava a mensagem na transação da operação: só é publicada se a operação commitar.
export async function registrarNoOutbox(tx: TxCliente, tipo: NomeFila, dados: object): Promise<void> {
  await tx.outboxMensagem.create({ data: { tipo, dados: dados as never } });
}

type Pendente = { id: string; tipo: NomeFila; dados: object };

// Publica um lote de mensagens pendentes. FOR UPDATE SKIP LOCKED: dois publicadores ao mesmo
// tempo não pegam a mesma linha. Entrega ao menos uma vez: se o processo cair entre o envio e o
// commit, a mensagem é enviada de novo (a chave única é o id do outbox; trate de forma idempotente).
export async function publicarOutbox(fila: Fila, cliente: PrismaClient, lote = 100): Promise<number> {
  return cliente.$transaction(async (tx) => {
    const pendentes = await tx.$queryRaw<Pendente[]>`
      SELECT id, tipo, dados FROM outbox_mensagem
       WHERE publicado_em IS NULL
       ORDER BY criado_em
       LIMIT ${lote}
       FOR UPDATE SKIP LOCKED`;
    for (const m of pendentes) await fila.enviar(m.tipo, m.dados, { chaveUnica: m.id });
    if (pendentes.length > 0) {
      await tx.outboxMensagem.updateMany({
        where: { id: { in: pendentes.map((m) => m.id) } },
        data: { publicadoEm: new Date() },
      });
    }
    return pendentes.length;
  });
}
