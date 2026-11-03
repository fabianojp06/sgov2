import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { criarObterNomeExibicao } from './nome-exibicao';

// O worker lê o nome de exibição do parametro_sistema (plano do P4, Task 9b, Step 1), com cliente falso.
const falso = (linha: { valor: string } | null) => {
  const findUnique = vi.fn(async () => linha);
  const cliente = { $transaction: async (f: (tx: unknown) => Promise<string>) => f({ parametroSistema: { findUnique } }) };
  return { cliente: cliente as unknown as Pick<PrismaClient, '$transaction'>, findUnique };
};

describe('criarObterNomeExibicao', () => {
  it('lê instituicao.nome_exibicao', async () => {
    const { cliente, findUnique } = falso({ valor: 'Instituto Exemplo' });
    expect(await criarObterNomeExibicao(cliente)()).toBe('Instituto Exemplo');
    expect(findUnique).toHaveBeenCalledWith({ where: { chave: 'instituicao.nome_exibicao' } });
  });

  it('vazio enquanto não cadastrado (o nome nunca vem do código)', async () => {
    expect(await criarObterNomeExibicao(falso(null).cliente)()).toBe('');
  });
});
