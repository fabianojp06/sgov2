import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { EventoAuditoria } from '@/shared/audit';
import type { FilaGerenciada } from '@/shared/filas';
import type { TransporteEmail } from './smtp';
import { criarTrabalhadorEmail, NOVAS_TENTATIVAS_EMAIL } from './trabalhador-email';

const eventos: EventoAuditoria[] = [];
let historicoFalha = false;
vi.mock('@/shared/audit', () => ({
  auditar: vi.fn(async (_tx: unknown, e: EventoAuditoria) => {
    if (historicoFalha) throw new Error('banco fora');
    eventos.push(e);
  }),
}));

const SENHA = 'Tmp-Segredo-987';
const URL_PUBLICA = 'https://sgo.exemplo';
const AGORA = new Date('2026-10-26T12:00:00.000Z');
const mensagem = {
  modelo: 'usuario.senha_inicial',
  versao: 1,
  destinatario: { email: 'maria@ex.org', nome: 'Maria' },
  dados: { nome: 'Maria', login: 'maria.silva', senhaTemporaria: SENHA, urlAcesso: `${URL_PUBLICA}/login` },
  criadoEm: '2026-10-26T11:00:00.000Z',
};
const JOB = { id: '0f2c1a6e-2b3d-4c5e-8f90-1a2b3c4d5e6f' };

type Cenario = {
  tentativas?: number;
  marcador?: boolean;
  transporte?: TransporteEmail | null;
  apagarFalha?: boolean;
  historicoFalha?: boolean;
};

function montar(c: Cenario = {}) {
  const enviados: unknown[] = [];
  const transporte: TransporteEmail | null =
    c.transporte === undefined
      ? {
          enviar: vi.fn(async (m) => {
            enviados.push(m);
          }),
        }
      : c.transporte;
  const apagarJob = vi.fn(async () => {
    if (c.apagarFalha) throw new Error('banco fora');
  });
  const fila = {
    consultar: vi.fn(async () => ({ estado: 'active', tentativas: c.tentativas ?? 0 })),
    apagarJob,
  } as unknown as FilaGerenciada;
  historicoFalha = c.historicoFalha ?? false;
  const findFirst = vi.fn(async () => (c.marcador ? { id: 1n } : null));
  const cliente = {
    historicoOperacao: { findFirst },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as PrismaClient;
  const trabalhar = criarTrabalhadorEmail({
    fila,
    transporte,
    cliente,
    urlPublica: URL_PUBLICA,
    agora: () => AGORA,
    obterNomeExibicao: async () => '',
  });
  return { trabalhar, enviados, apagarJob, transporte, findFirst };
}

const ultimoResultado = () => (eventos.at(-1)?.depois as { resultado?: string } | undefined)?.resultado;
const erroSmtp = (codigo: number) => Object.assign(new Error(`${codigo} maria@ex.org recusado`), { responseCode: codigo });

let logs: string[];
beforeEach(() => {
  eventos.length = 0;
  logs = [];
  for (const nivel of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      logs.push(JSON.stringify(args));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  // Nunca a senha temporária em log nem no Histórico.
  expect(logs.join('\n')).not.toContain(SENHA);
  expect(JSON.stringify(eventos)).not.toContain(SENHA);
});

describe('trabalhador de e-mail', () => {
  it('são 3 novas tentativas (EP083)', () => {
    expect(NOVAS_TENTATIVAS_EMAIL).toBe(3);
  });

  it('sucesso: 1 envio, Histórico "enviado" e o job apagado', async () => {
    const t = montar();
    await t.trabalhar(mensagem, JOB);
    expect(t.enviados).toHaveLength(1);
    expect(t.enviados[0]).toMatchObject({ para: { email: 'maria@ex.org', nome: 'Maria' }, assunto: '[SGO 2.0][Acesso] Seu acesso ao sistema' });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ funcionalidade: 'ger.email', tipo: 'SISTEMA', origem: 'SISTEMA', registroId: JOB.id });
    expect(eventos[0]?.depois).toEqual({
      modelo: 'usuario.senha_inicial',
      versao: 1,
      destinatario: 'ma***(12)',
      tentativa: 0,
      resultado: 'enviado',
      motivo: {},
    });
    expect(t.apagarJob).toHaveBeenCalledWith('email.enviar', JOB.id);
  });

  it('falha na tentativa 1: relança, sem apagar o job (os dados ficam para a nova tentativa)', async () => {
    const t = montar({ tentativas: 1, transporte: { enviar: vi.fn(async () => Promise.reject(erroSmtp(421))) } });
    const erro = await t.trabalhar(mensagem, JOB).catch((e: unknown) => e as Error);
    // Mensagem exata: o erro que vai para a fila (e para o output do job) não leva dado do e-mail.
    expect((erro as Error).message).toBe('Envio de e-mail falhou (tentativa 2 de 4)');
    expect(ultimoResultado()).toBe('falha_temporaria');
    expect(t.apagarJob).not.toHaveBeenCalled();
  });

  it('550 na primeira tentativa também tenta de novo (R9)', async () => {
    const t = montar({ tentativas: 0, transporte: { enviar: vi.fn(async () => Promise.reject(erroSmtp(550))) } });
    await expect(t.trabalhar(mensagem, JOB)).rejects.toThrow();
    expect(eventos[0]?.depois).toMatchObject({ resultado: 'falha_temporaria', motivo: { resposta: 550 } });
  });

  it('falha na tentativa 3 (4ª execução): definitiva, não relança e apaga o job', async () => {
    const t = montar({ tentativas: 3, transporte: { enviar: vi.fn(async () => Promise.reject(erroSmtp(550))) } });
    await t.trabalhar(mensagem, JOB);
    expect(ultimoResultado()).toBe('falha_definitiva');
    expect(t.apagarJob).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes('[EMAIL_FALHA_DEFINITIVA]'))).toBe(true);
  });

  it('o erro do servidor não vai para log nem Histórico com o endereço', async () => {
    const t = montar({ tentativas: 3, transporte: { enviar: vi.fn(async () => Promise.reject(erroSmtp(550))) } });
    await t.trabalhar(mensagem, JOB);
    expect(logs.join('\n') + JSON.stringify(eventos)).not.toContain('maria@ex.org');
  });

  it('mensagem com mais de 24 h: expirada, sem envio, e o job apagado', async () => {
    const t = montar();
    await t.trabalhar({ ...mensagem, criadoEm: '2026-10-25T11:00:00.000Z' }, JOB);
    expect(t.enviados).toEqual([]);
    expect(ultimoResultado()).toBe('expirada');
    expect(t.apagarJob).toHaveBeenCalledTimes(1);
  });

  it('sem SMTP: a tentativa falha e segue as mesmas regras', async () => {
    const t = montar({ tentativas: 0, transporte: null });
    await expect(t.trabalhar(mensagem, JOB)).rejects.toThrow();
    expect(eventos[0]?.depois).toMatchObject({ resultado: 'falha_temporaria', motivo: { codigo: 'email.smtp_nao_configurado' } });
    const ultima = montar({ tentativas: 3, transporte: null });
    await ultima.trabalhar(mensagem, JOB);
    expect(ultimoResultado()).toBe('falha_definitiva');
    expect(ultima.apagarJob).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['link de outra origem', { ...mensagem, dados: { ...mensagem.dados, urlAcesso: 'https://atacante.exemplo/login' } }],
    ['destinatário com CRLF', { ...mensagem, destinatario: { email: 'a@b.org\r\nBcc: x@y.org' } }],
    ['modelo desconhecido', { ...mensagem, modelo: 'constructor' }],
    ['versão inexistente', { ...mensagem, versao: 99 }],
    ['sem criadoEm', { ...mensagem, criadoEm: undefined }],
    ['payload que não é objeto', 'texto'],
  ])('%s: falha definitiva, sem envio, e o job apagado', async (_caso, m) => {
    const t = montar();
    await t.trabalhar(m, JOB);
    expect(t.enviados).toEqual([]);
    expect(ultimoResultado()).toBe('falha_definitiva');
    expect(t.apagarJob).toHaveBeenCalledTimes(1);
  });

  it('envio com sucesso e apagarJob falhando → log e relança (o marcador já está gravado)', async () => {
    const t = montar({ apagarFalha: true });
    await expect(t.trabalhar(mensagem, JOB)).rejects.toThrow('banco fora');
    expect(t.enviados).toHaveLength(1);
    expect(ultimoResultado()).toBe('enviado');
    expect(logs.some((l) => l.includes('[EMAIL_JOB_NAO_APAGADO]'))).toBe(true);
  });

  it('o marcador procura só o "enviado" deste job', async () => {
    const t = montar();
    await t.trabalhar(mensagem, JOB);
    expect(t.findFirst).toHaveBeenCalledWith({
      where: { funcionalidade: 'ger.email', registroId: JOB.id, depois: { path: ['resultado'], equals: 'enviado' } },
      select: { id: true },
    });
  });

  it('marcador encontrado e apagarJob falhando → relança, para a próxima execução apagar', async () => {
    const t = montar({ marcador: true, apagarFalha: true });
    await expect(t.trabalhar(mensagem, JOB)).rejects.toThrow('banco fora');
    expect(t.enviados).toEqual([]);
  });

  it('criadoEm no futuro (mensagem adulterada): falha definitiva, sem envio', async () => {
    const t = montar();
    await t.trabalhar({ ...mensagem, criadoEm: '2026-10-26T13:00:00.000Z' }, JOB);
    expect(t.enviados).toEqual([]);
    expect(eventos[0]?.depois).toMatchObject({ resultado: 'falha_definitiva', motivo: { codigo: 'email.criado_no_futuro' } });
  });

  it('Histórico falhando num resultado final: o job é apagado e a falha fica no log', async () => {
    const t = montar({ historicoFalha: true });
    await t.trabalhar(mensagem, JOB);
    expect(t.apagarJob).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes('[EMAIL_HISTORICO_FALHOU]'))).toBe(true);
  });

  it('Histórico falhando numa falha temporária: relança, sem apagar', async () => {
    const t = montar({ historicoFalha: true, transporte: { enviar: vi.fn(async () => Promise.reject(erroSmtp(421))) } });
    await expect(t.trabalhar(mensagem, JOB)).rejects.toThrow('banco fora');
    expect(t.apagarJob).not.toHaveBeenCalled();
  });

  it('m1: nova execução do mesmo job com o marcador "enviado" só apaga, sem enviar', async () => {
    const t = montar({ marcador: true });
    await t.trabalhar(mensagem, JOB);
    expect(t.enviados).toEqual([]);
    expect(eventos).toEqual([]);
    expect(t.apagarJob).toHaveBeenCalledTimes(1);
  });

  it('falha definitiva e apagarJob falhando → log e relança', async () => {
    const t = montar({ tentativas: 3, apagarFalha: true, transporte: { enviar: vi.fn(async () => Promise.reject(erroSmtp(550))) } });
    await expect(t.trabalhar(mensagem, JOB)).rejects.toThrow('banco fora');
    expect(logs.some((l) => l.includes('[EMAIL_JOB_NAO_APAGADO]'))).toBe(true);
  });
});
