import { PgBoss } from 'pg-boss';
import { ErroDominio } from '@/shared/kernel';
import type { EstadoJob, FilaGerenciada, NomeFila, OpcoesEnvio } from './fila';

// Novas tentativas: 5, com espera inicial de 30 s e backoff exponencial (US-010).
const NOVAS_TENTATIVAS = 5;
const ESPERA_S = 30;

function opcoesDeJob(opcoes?: OpcoesEnvio) {
  const novas = opcoes?.tentativas === undefined ? NOVAS_TENTATIVAS : opcoes.tentativas - 1;
  if (!Number.isInteger(novas) || novas < 0) {
    throw new ErroDominio('TENTATIVAS_INVALIDAS', `Tentativas inválidas: ${opcoes?.tentativas}`);
  }
  return {
    retryLimit: novas,
    retryDelay: ESPERA_S,
    retryBackoff: true,
    ...(opcoes?.chaveUnica === undefined ? {} : { singletonKey: opcoes.chaveUnica }),
  };
}

// Fila sobre o pg-boss, no schema pgboss, conectando como sgo_fila (FILA_DATABASE_URL).
export async function criarFila(urlBanco: string): Promise<FilaGerenciada> {
  const boss = new PgBoss({ connectionString: urlBanco, schema: 'pgboss' });
  boss.on('error', (erro) => console.error('[FILA_ERRO]', erro instanceof Error ? erro.message : erro));
  await boss.start();
  const criadas = new Set<string>();

  async function garantirFila(nome: NomeFila): Promise<void> {
    if (criadas.has(nome)) return;
    await boss.createQueue(nome);
    criadas.add(nome);
  }

  return {
    async enviar(nome, dados, opcoes) {
      await garantirFila(nome);
      const id = await boss.send(nome, dados, opcoesDeJob(opcoes));
      if (id === null) {
        throw new ErroDominio('JOB_NAO_CRIADO', `Job não criado na fila ${nome} (chave única já pendente?)`, {
          nome,
          chaveUnica: opcoes?.chaveUnica,
        });
      }
      return id;
    },

    async registrarTrabalhador(nome, tratar) {
      await garantirFila(nome);
      await boss.work(nome, async (jobs) => {
        for (const job of jobs) await tratar(job.data as Parameters<typeof tratar>[0]);
      });
    },

    async consultar(nome, id) {
      const job = await boss.getJobById(nome, id);
      return job ? { estado: job.state as EstadoJob, tentativas: job.retryCount } : null;
    },

    async parar() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
