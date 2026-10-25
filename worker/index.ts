import { lerEnv } from '@/shared/config/env';
import { criarPrisma } from '@/shared/db';
import { criarFila, publicarOutbox } from '@/shared/filas';

// Worker (US-010): processo separado da aplicação. Publica o outbox a cada 10 s e executa
// os trabalhadores das filas. Os trabalhadores de cada módulo ficam em
// src/modules/<mod>/infrastructure e são registrados aqui (spec §12.3).
const INTERVALO_OUTBOX_MS = 10_000;

async function iniciar(): Promise<void> {
  const env = lerEnv();
  if (!env.FILA_DATABASE_URL) throw new Error('FILA_DATABASE_URL não definida (veja o .env.example)');

  const prisma = criarPrisma(env.DATABASE_URL);
  const fila = await criarFila(env.FILA_DATABASE_URL);

  let publicando = false;
  const temporizador = setInterval(() => {
    if (publicando) return;
    publicando = true;
    publicarOutbox(fila, prisma)
      .catch((erro: unknown) => console.error('[OUTBOX_FALHOU]', erro instanceof Error ? erro.message : erro))
      .finally(() => {
        publicando = false;
      });
  }, INTERVALO_OUTBOX_MS);

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`worker: ${sinal} recebido, encerrando`);
    clearInterval(temporizador);
    await fila.parar();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));

  console.log('worker pronto');
}

iniciar().catch((erro: unknown) => {
  console.error('[WORKER_FALHOU]', erro);
  process.exit(1);
});
