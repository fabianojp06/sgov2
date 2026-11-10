import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import { registrarTrabalhadoresGer } from './servidor';

// O registro do trabalhador de e-mail: todo erro que volta para a fila fica no log, só com nome e
// código, e é relançado (para a fila tentar de novo).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('registrarTrabalhadoresGer', () => {
  it('sem SMTP, registra email.enviar e exportacao.gerar e avisa [EMAIL_SEM_SMTP]', async () => {
    vi.stubEnv('SMTP_HOST', '');
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void avisos.push(String(a[0])));
    const nomes: string[] = [];
    const fila = { registrarTrabalhador: vi.fn(async (nome: string) => void nomes.push(nome)) } as unknown as FilaGerenciada;
    await registrarTrabalhadoresGer(fila, { cliente: {} as PrismaClient });
    expect(nomes).toEqual(['email.enviar', 'exportacao.gerar']);
    expect(avisos).toContain('[EMAIL_SEM_SMTP] SMTP_HOST não definido: os e-mails falham até a configuração.');
  });

  it('erro do trabalhador: [EMAIL_TENTATIVA_FALHOU] só com nome e código, e relança', async () => {
    vi.stubEnv('SMTP_HOST', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a)));
    let handler: ((m: unknown, job: { id: string }) => Promise<void>) | undefined;
    const fila = {
      registrarTrabalhador: vi.fn(async (nome: string, h: typeof handler) => {
        if (nome === 'email.enviar') handler = h;
      }),
    } as unknown as FilaGerenciada;
    const falha = Object.assign(new Error('conexão recusada para maria@ex.org'), { code: 'ECONNREFUSED' });
    const cliente = { historicoOperacao: { findFirst: async () => Promise.reject(falha) } } as unknown as PrismaClient;
    await registrarTrabalhadoresGer(fila, { cliente });
    await expect(handler!({}, { id: 'job-1' })).rejects.toBe(falha);
    expect(logs).toEqual([JSON.stringify(['[EMAIL_TENTATIVA_FALHOU]', { job: 'job-1', tipo: 'Error', codigo: 'ECONNREFUSED' }])]);
    expect(logs.join('\n')).not.toContain('maria@ex.org');
  });
});
