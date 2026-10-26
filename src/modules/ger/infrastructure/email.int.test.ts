import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import type { PrismaClient } from '@/generated/prisma/client';
import { criarPrisma } from '@/shared/db';
import { criarFila, publicarOutbox, type FilaGerenciada } from '@/shared/filas';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { enviarEmail } from '../application/email';
import { criarTransporteSmtp } from './smtp';
import { criarTrabalhadorEmail } from './trabalhador-email';

// US-025 de ponta a ponta (plano do P4, Task 1b, Step 2): outbox → pg-boss → trabalhador → SMTP,
// com Postgres real (Testcontainers, D12) e um servidor SMTP em processo, em 127.0.0.1, sem TLS.
const SENHA = 'Tmp-Integracao-4567';
const URL_PUBLICA = 'https://sgo.exemplo';
const dados = { nome: 'Maria', login: 'maria.silva', senhaTemporaria: SENHA, urlAcesso: `${URL_PUBLICA}/login` };

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let prisma: PrismaClient;
let fila: FilaGerenciada;
let filaSql: pg.Client;
let smtp: SMTPServer;
let porta = 0;
let recusar = false;
const recebidas: string[] = [];

function trabalhador(agora = () => new Date()) {
  return criarTrabalhadorEmail({
    fila,
    transporte: criarTransporteSmtp({
      host: '127.0.0.1',
      porta,
      seguranca: 'nenhuma',
      remetente: { nome: 'SGO 2.0', email: 'nao-responda@sgo.local' },
    }),
    cliente: prisma,
    urlPublica: URL_PUBLICA,
    agora,
    obterNomeExibicao: async () => '',
  });
}

// Grava pelo caso de uso, publica o outbox e devolve o job criado (id = id da linha do outbox).
async function enfileirar(destinatario = { email: 'maria@ex.org', nome: 'Maria' }): Promise<{ id: string; data: unknown }> {
  await prisma.$transaction((tx) => enviarEmail(tx, 'usuario.senha_inicial', destinatario, dados));
  await publicarOutbox(fila, prisma);
  const { rows } = await filaSql.query<{ id: string; data: unknown }>(
    `SELECT id::text, data FROM pgboss.job WHERE name = 'email.enviar' ORDER BY created_on DESC LIMIT 1`,
  );
  if (!rows[0]) throw new Error('job não criado');
  return rows[0];
}

// A senha temporária não pode sobrar em lugar nenhum do banco depois do resultado final.
async function ocorrenciasDaSenha(): Promise<number> {
  const padrao = `%${SENHA}%`;
  const job = await filaSql.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE data::text LIKE $1 OR output::text LIKE $1`, [padrao]);
  const outbox = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM outbox_mensagem WHERE dados::text LIKE ${padrao}`;
  const historico = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM historico_operacao h WHERE row_to_json(h)::text LIKE ${padrao}`;
  return (job.rows[0] as { n: number }).n + Number(outbox[0]?.n) + Number(historico[0]?.n);
}

beforeAll(async () => {
  vi.stubEnv('URL_PUBLICA', URL_PUBLICA);
  banco = await iniciarBancoTeste();
  prisma = criarPrisma(banco.urlApp);
  fila = await criarFila(banco.urlFila);
  filaSql = new pg.Client({ connectionString: banco.urlFila });
  await filaSql.connect();
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onRcptTo(_endereco, _sessao, callback) {
      if (!recusar) return callback();
      const erro = Object.assign(new Error('Caixa inexistente'), { responseCode: 550 });
      return callback(erro);
    },
    onData(stream, _sessao, callback) {
      let texto = '';
      stream.on('data', (parte: Buffer) => (texto += parte.toString('utf8')));
      stream.on('end', () => {
        recebidas.push(texto);
        callback();
      });
    },
  });
  await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
  porta = (smtp.server.address() as { port: number }).port;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((ok) => smtp?.close(() => ok()));
  await filaSql?.end();
  await fila?.parar();
  await prisma?.$disconnect();
  await banco?.parar();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  recebidas.length = 0;
  recusar = false;
});

describe('e-mail de ponta a ponta', () => {
  it('commit: o e-mail chega na versão 1 e a senha não sobra no banco', async () => {
    const job = await enfileirar();
    await trabalhador()(job.data, { id: job.id });
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]).toContain('Subject: [SGO 2.0][Acesso] Seu acesso ao sistema');
    expect(recebidas[0]).toContain(SENHA);
    expect(await ocorrenciasDaSenha()).toBe(0);
    const historico = await prisma.historicoOperacao.findMany({ where: { funcionalidade: 'ger.email', registroId: job.id } });
    expect(historico.map((h) => (h.depois as { resultado: string }).resultado)).toEqual(['enviado']);
  });

  it('rollback: nenhuma linha no outbox e nada no SMTP', async () => {
    const antes = await prisma.outboxMensagem.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org' }, dados);
        throw new Error('caso de uso falhou depois');
      }),
    ).rejects.toThrow('caso de uso falhou depois');
    expect(await prisma.outboxMensagem.count()).toBe(antes);
    expect(recebidas).toEqual([]);
  });

  it('550 quatro vezes: 4 Históricos, o último definitivo, e a senha não sobra', async () => {
    recusar = true;
    const job = await enfileirar({ email: 'inexistente@ex.org', nome: 'X' });
    const trabalhar = trabalhador();
    for (let tentativa = 0; tentativa <= 3; tentativa++) {
      // A contagem de tentativas é a do pg-boss, lida pelo consultar real.
      await filaSql.query(`UPDATE pgboss.job SET retry_count = $1 WHERE id = $2::uuid`, [tentativa, job.id]);
      if (tentativa < 3) await expect(trabalhar(job.data, { id: job.id })).rejects.toThrow();
      else await trabalhar(job.data, { id: job.id });
    }
    const historico = await prisma.historicoOperacao.findMany({
      where: { funcionalidade: 'ger.email', registroId: job.id },
      orderBy: { id: 'asc' },
    });
    expect(historico.map((h) => (h.depois as { resultado: string }).resultado)).toEqual([
      'falha_temporaria',
      'falha_temporaria',
      'falha_temporaria',
      'falha_definitiva',
    ]);
    expect(recebidas).toEqual([]);
    expect(await ocorrenciasDaSenha()).toBe(0);
  });

  it('expiração: mensagem com mais de 24 h não é enviada e a senha não sobra', async () => {
    const job = await enfileirar();
    await trabalhador(() => new Date(Date.now() + 25 * 60 * 60 * 1000))(job.data, { id: job.id });
    expect(recebidas).toEqual([]);
    expect(await ocorrenciasDaSenha()).toBe(0);
  });

  it('destinatário inválido é recusado antes de gravar', async () => {
    const antes = await prisma.outboxMensagem.count();
    await expect(
      prisma.$transaction((tx) => enviarEmail(tx, 'usuario.senha_inicial', { email: 'a@b.org\r\nBcc: x@y.org' }, dados)),
    ).rejects.toMatchObject({ codigo: 'email.destinatario_invalido' });
    expect(await prisma.outboxMensagem.count()).toBe(antes);
  });
});
