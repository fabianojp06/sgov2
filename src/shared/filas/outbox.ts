import type { PrismaClient } from '@/generated/prisma/client';
import type { TxCliente } from '@/shared/db';
import type { Fila, NomeFila } from './fila';

// Grava a mensagem na transação da operação: só é publicada se a operação commitar.
export async function registrarNoOutbox(tx: TxCliente, tipo: NomeFila, dados: object): Promise<void> {
  await tx.outboxMensagem.create({ data: { tipo, dados: dados as never } });
}

export const MAX_TENTATIVAS_OUTBOX = 10;
const TEMPO_POR_MENSAGEM_MS = 15_000;

type Pendente = { id: string; tipo: NomeFila; dados: object };

// Publica até `lote` mensagens pendentes, uma por transação:
// - FOR UPDATE SKIP LOCKED: publicadores concorrentes não pegam a mesma linha;
// - o id do outbox é o id do job: se o processo cair entre o envio e a marcação, o reenvio não
//   duplica o job;
// - depois de publicada, os dados saem da linha (o job já os tem);
// - mensagem que falha registra a tentativa e o erro e não trava as outras; com
//   MAX_TENTATIVAS_OUTBOX tentativas, para de ser lida e fica visível no banco.
export async function publicarOutbox(fila: Fila, cliente: PrismaClient, lote = 100): Promise<number> {
  let publicadas = 0;
  const vistas = new Set<string>();
  for (let i = 0; i < lote; i++) {
    const resultado = await cliente.$transaction(
      async (tx) => {
        const [m] = await tx.$queryRaw<Pendente[]>`
          SELECT id, tipo, dados FROM outbox_mensagem
           WHERE publicado_em IS NULL AND tentativas < ${MAX_TENTATIVAS_OUTBOX}
             AND NOT (id::text = ANY(${[...vistas]}::text[]))
           ORDER BY criado_em
           LIMIT 1
           FOR UPDATE SKIP LOCKED`;
        if (!m) return 'vazio' as const;
        vistas.add(m.id);
        try {
          await fila.enviar(m.tipo, m.dados, { chaveUnica: m.id });
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : String(erro);
          console.error('[OUTBOX_MENSAGEM_FALHOU]', { id: m.id, tipo: m.tipo, erro: mensagem });
          await tx.outboxMensagem.update({
            where: { id: m.id },
            data: { tentativas: { increment: 1 }, ultimoErro: mensagem.slice(0, 1000) },
          });
          return 'falhou' as const;
        }
        await tx.outboxMensagem.update({ where: { id: m.id }, data: { publicadoEm: new Date(), dados: {} } });
        return 'publicada' as const;
      },
      { timeout: TEMPO_POR_MENSAGEM_MS },
    );
    if (resultado === 'vazio') break;
    if (resultado === 'publicada') publicadas++;
  }
  return publicadas;
}
