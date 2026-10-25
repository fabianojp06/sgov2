import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { ErroDominio } from '@/shared/kernel';
import { NOMES_FILA, type EstadoJob, type FilaGerenciada, type NomeFila, type OpcoesEnvio } from './fila';

// Novas tentativas: 5, com espera inicial de 30 s e backoff exponencial (US-010).
const NOVAS_TENTATIVAS = 5;
const ESPERA_S = 30;
const uuid = z.uuid();

function opcoesDeJob(opcoes?: OpcoesEnvio) {
  const novas = opcoes?.tentativas === undefined ? NOVAS_TENTATIVAS : opcoes.tentativas - 1;
  if (!Number.isInteger(novas) || novas < 0) {
    throw new ErroDominio('TENTATIVAS_INVALIDAS', `Tentativas inválidas: ${opcoes?.tentativas}`);
  }
  if (opcoes?.chaveUnica !== undefined && !uuid.safeParse(opcoes.chaveUnica).success) {
    throw new ErroDominio('CHAVE_UNICA_INVALIDA', 'A chave única do job deve ser um UUID');
  }
  return {
    retryLimit: novas,
    retryDelay: ESPERA_S,
    retryBackoff: true,
    // O id do job é a chave: o pg-boss ignora um segundo envio com o mesmo id.
    ...(opcoes?.chaveUnica === undefined ? {} : { id: opcoes.chaveUnica }),
  };
}

const resumo = (erro: unknown) =>
  erro instanceof Error ? { nome: erro.name, mensagem: erro.message, pilha: erro.stack } : String(erro);

// Fila sobre o pg-boss, no schema pgboss (criado pelo DBA com o sgo_fila como dono), conectando
// como sgo_fila (FILA_DATABASE_URL).
export async function criarFila(urlBanco: string): Promise<FilaGerenciada> {
  const boss = new PgBoss({ connectionString: urlBanco, schema: 'pgboss', createSchema: false });
  boss.on('error', (erro) => console.error('[FILA_ERRO]', resumo(erro)));
  await boss.start();
  const criadas = new Set<string>();
  const comTrabalhador = new Set<NomeFila>();

  async function garantirFila(nome: NomeFila): Promise<void> {
    if (criadas.has(nome)) return;
    // O nome pode vir do banco (outbox): fila desconhecida é erro, nunca uma fila nova.
    if (!(NOMES_FILA as readonly string[]).includes(nome)) {
      throw new ErroDominio('FILA_DESCONHECIDA', `Fila desconhecida: ${String(nome).slice(0, 64)}`);
    }
    await boss.createQueue(nome);
    criadas.add(nome);
  }

  return {
    async enviar(nome, dados, opcoes) {
      await garantirFila(nome);
      const id = await boss.send(nome, dados, opcoesDeJob(opcoes));
      if (id !== null) return id;
      // Sem id de volta: o job com essa chave já existe (envio repetido, idempotente).
      if (opcoes?.chaveUnica !== undefined) return opcoes.chaveUnica;
      throw new ErroDominio('JOB_NAO_CRIADO', `Job não criado na fila ${nome}`, { nome });
    },

    async registrarTrabalhador(nome, tratar) {
      await garantirFila(nome);
      // Um job por vez: a falha de um não reprocessa outros do mesmo lote.
      await boss.work(nome, { batchSize: 1 }, async (jobs) => {
        for (const job of jobs) await tratar(job.data as Parameters<typeof tratar>[0], { id: job.id });
      });
      comTrabalhador.add(nome);
    },

    async consultar(nome, id) {
      const job = await boss.getJobById(nome, id);
      return job ? { estado: job.state as EstadoJob, tentativas: job.retryCount } : null;
    },

    async reprocessar(nome, id) {
      await boss.retry(nome, id);
    },

    filasComTrabalhador: () => [...comTrabalhador],

    async parar() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
