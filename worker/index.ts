import { rmSync, writeFileSync } from 'node:fs';
import { GERADORES_EXPORTACAO_ADM } from '@/modules/adm/servidor';
import { limparExportacoes, registrarTrabalhadoresGer } from '@/modules/ger/servidor';
import { lerEnv } from '@/shared/config/env';
import { criarPrisma } from '@/shared/db';
import { criarFila, publicarOutbox } from '@/shared/filas';
import { GERADORES_EXPORTACAO_CAD, iniciarProcessadorCargas } from '@/modules/cad/servidor';
import { lerConfiguracaoWorker } from './configuracao';
import { criarObterNomeExibicao } from './nome-exibicao';

// Worker (US-010): processo separado da aplicação. Publica o outbox a cada 10 s e executa
// os trabalhadores das filas. Os trabalhadores de cada módulo ficam em
// src/modules/<mod>/infrastructure e são registrados aqui, sempre pelo servidor.ts do módulo
// (spec §12.3; plano do P4, R22): o bundle do worker não leva código de tela.
const INTERVALO_OUTBOX_MS = 10_000;
// Falhas seguidas do publicador (banco fora, credencial revogada): sai para o orquestrador reiniciar.
const FALHAS_PARA_SAIR = 6;
// Publicação presa (conexão meio aberta, lock sem timeout) não conta como falha: sem este limite,
// o worker ficaria vivo sem publicar nada. Bem acima de um lote normal.
const LIMITE_CICLO_MS = 5 * 60_000;
// Sinal de vida para o healthcheck da imagem (docker/saude.sh): gravado a cada tique depois do
// primeiro ciclo com sucesso, enquanto nenhum ciclo em curso passa de SINAL_ATE_MS.
const ARQUIVO_VIVO = '/tmp/sgo-worker-vivo';
const SINAL_ATE_MS = 60_000;
// Encerramento com conexão presa (fila.parar, $disconnect): sai assim mesmo, antes do SIGKILL
// do stop_grace_period de 10 s.
const LIMITE_ENCERRAR_MS = 9_000;
// Limpeza das exportações em segundo plano (US-024): sem resposta vira falha, vencida é apagada.
const INTERVALO_LIMPEZA_MS = 15 * 60_000;

function marcarVivo(): void {
  try {
    writeFileSync(ARQUIVO_VIVO, String(Date.now()));
  } catch (erro) {
    console.error('[WORKER_SINAL_DE_VIDA_FALHOU]', resumo(erro));
  }
}

const resumo = (erro: unknown) =>
  erro instanceof Error ? { nome: erro.name, mensagem: erro.message, pilha: erro.stack } : String(erro);

async function iniciar(): Promise<void> {
  // Um sinal de vida de antes de um reinício do mesmo contêiner não vale para este processo.
  rmSync(ARQUIVO_VIVO, { force: true });
  const env = lerEnv();
  if (!env.FILA_DATABASE_URL) throw new Error('FILA_DATABASE_URL não definida (veja o .env.example)');
  const { ambiente } = lerConfiguracaoWorker();

  const prisma = criarPrisma(env.DATABASE_URL);
  const fila = await criarFila(env.FILA_DATABASE_URL);
  // Exportação assíncrona (US-024): os geradores vêm dos módulos donos das listagens.
  await registrarTrabalhadoresGer(fila, {
    cliente: prisma,
    obterNomeExibicao: criarObterNomeExibicao(prisma),
    geradoresExportacao: { ...GERADORES_EXPORTACAO_CAD, ...GERADORES_EXPORTACAO_ADM },
  });
  // Merge das cargas de estrutura (plano do P4, R6): só o worker tem o sgo_sync. Sem a variável,
  // o processador avisa [CARGA_SEM_SYNC] e os lotes ficam PENDENTE, visíveis na tela.
  const urlSync = process.env.SYNC_DATABASE_URL;
  const clienteSync = urlSync ? criarPrisma(urlSync) : null;
  const cargas = iniciarProcessadorCargas({ clienteSync });

  const limpar = () =>
    limparExportacoes(prisma, new Date())
      .then((r) => {
        if (r.semResposta > 0 || r.apagados > 0) console.log('[EXPORTACOES_LIMPAS]', r);
      })
      .catch((erro: unknown) => console.error('[EXPORTACOES_LIMPEZA_FALHOU]', resumo(erro)));
  void limpar();
  const temporizadorLimpeza = setInterval(() => void limpar(), INTERVALO_LIMPEZA_MS);

  let emCurso: Promise<unknown> | null = null;
  let inicioCiclo = 0;
  let falhasSeguidas = 0;
  let publicouUmaVez = false;
  const temporizador = setInterval(() => {
    if (emCurso) {
      if (Date.now() - inicioCiclo > LIMITE_CICLO_MS) {
        console.error('[OUTBOX_TRAVADO]', { segundos: Math.round((Date.now() - inicioCiclo) / 1000) });
        void encerrar('publicação do outbox travada', 1, false);
      } else if (publicouUmaVez && Date.now() - inicioCiclo < SINAL_ATE_MS) {
        marcarVivo();
      }
      return;
    }
    inicioCiclo = Date.now();
    emCurso = publicarOutbox(fila, prisma)
      .then(() => {
        falhasSeguidas = 0;
        publicouUmaVez = true;
        marcarVivo();
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
  // drenar = false só quando a publicação está travada: esperar por ela seria esperar para sempre.
  async function encerrar(motivo: string, codigo = 0, drenar = true): Promise<void> {
    if (encerrando) return;
    encerrando = true;
    console.log(`worker: ${motivo}, encerrando`);
    setTimeout(() => {
      console.error('[WORKER_ENCERRAMENTO_FORCADO]', { motivo });
      process.exit(codigo || 1);
    }, LIMITE_ENCERRAR_MS).unref();
    clearInterval(temporizador);
    clearInterval(temporizadorLimpeza);
    try {
      if (drenar) await emCurso; // drena a publicação em andamento antes de fechar as conexões
      await Promise.all([cargas.parar(), fila.parar()]);
    } finally {
      await Promise.allSettled([prisma.$disconnect(), clienteSync?.$disconnect()]);
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
  console.log('worker pronto', { ambiente, filas, cargas: clienteSync ? 'sgo_sync' : 'sem SYNC_DATABASE_URL' });
}

process.on('unhandledRejection', (erro) => {
  console.error('[WORKER_REJEICAO_NAO_TRATADA]', resumo(erro));
  process.exit(1);
});

iniciar().catch((erro: unknown) => {
  console.error('[WORKER_FALHOU]', resumo(erro));
  process.exit(1);
});
