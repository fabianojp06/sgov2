import { lerEnv } from '@/shared/config/env';
import { criarPrisma } from '@/shared/db';
import { criarFila, publicarOutbox } from '@/shared/filas';

// Worker (US-010): processo separado da aplicação. Publica o outbox a cada 10 s e executa
// os trabalhadores das filas. Os trabalhadores de cada módulo ficam em
// src/modules/<mod>/infrastructure e são registrados aqui (spec §12.3).
const INTERVALO_OUTBOX_MS = 10_000;
// Falhas seguidas do publicador (banco fora, credencial revogada): sai para o orquestrador reiniciar.
const FALHAS_PARA_SAIR = 6;

const resumo = (erro: unknown) =>
  erro instanceof Error ? { nome: erro.name, mensagem: erro.message, pilha: erro.stack } : String(erro);

async function iniciar(): Promise<void> {
  const env = lerEnv();
  if (!env.FILA_DATABASE_URL) throw new Error('FILA_DATABASE_URL não definida (veja o .env.example)');

  const prisma = criarPrisma(env.DATABASE_URL);
  const fila = await criarFila(env.FILA_DATABASE_URL);

  let emCurso: Promise<unknown> | null = null;
  let falhasSeguidas = 0;
  const temporizador = setInterval(() => {
    if (emCurso) return;
    emCurso = publicarOutbox(fila, prisma)
      .then(() => {
        falhasSeguidas = 0;
      })
      .catch((erro: unknown) => {
        falhasSeguidas++;
        console.error('[OUTBOX_FALHOU]', { falhasSeguidas, erro: resumo(erro) });
        if (falhasSeguidas >= FALHAS_PARA_SAIR) void encerrar('falhas seguidas no outbox', 1);
      })
      .finally(() => {
        emCurso = null;
      });
  }, INTERVALO_OUTBOX_MS);

  let encerrando = false;
  async function encerrar(motivo: string, codigo = 0): Promise<void> {
    if (encerrando) return;
    encerrando = true;
    console.log(`worker: ${motivo}, encerrando`);
    clearInterval(temporizador);
    try {
      await emCurso; // drena a publicação em andamento antes de fechar as conexões
      await fila.parar();
    } finally {
      await prisma.$disconnect();
    }
    process.exit(codigo);
  }
  const aoSinal = (sinal: string) =>
    encerrar(`${sinal} recebido`).catch((erro: unknown) => {
      console.error('[WORKER_ENCERRAMENTO_FALHOU]', resumo(erro));
      process.exit(1);
    });
  process.on('SIGTERM', () => void aoSinal('SIGTERM'));
  process.on('SIGINT', () => void aoSinal('SIGINT'));

  const filas = fila.filasComTrabalhador();
  if (filas.length === 0) console.warn('[WORKER_SEM_TRABALHADORES] jobs enviados ficarão pendentes até haver trabalhador');
  console.log('worker pronto', { filas });
}

process.on('unhandledRejection', (erro) => {
  console.error('[WORKER_REJEICAO_NAO_TRATADA]', resumo(erro));
  process.exit(1);
});

iniciar().catch((erro: unknown) => {
  console.error('[WORKER_FALHOU]', resumo(erro));
  process.exit(1);
});
