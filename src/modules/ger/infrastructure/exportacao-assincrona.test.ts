import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { auditar } from '@/shared/audit';
import { ok } from '@/shared/kernel';
import { LIMITE_EXPORTACAO_ASSINCRONA } from './exportacao';
import { criarTrabalhadorExportacao, type GeradorExportacao } from './exportacao-assincrona';

// O trabalhador de exportacao.gerar sem banco (pendências da revisão do #354): o tempo da transação
// e o teto de linhas. O fluxo completo, num Postgres real, está no cad (exportar-estrutura.int.test.ts).
vi.mock('@/shared/audit', () => ({ auditar: vi.fn(async () => {}) }));

const PEDIDO = '0a1b2c3d-0000-4000-8000-000000000001';

function clienteFalso() {
  const updates: Record<string, unknown>[] = [];
  const opcoes: unknown[] = [];
  const tx = {
    $queryRaw: async () => [{ id: PEDIDO }],
    usuario: { findUnique: async () => null }, // sem aviso: o aviso é testado no cad, com banco
    exportacaoPedido: {
      findUniqueOrThrow: async () => ({
        id: PEDIDO,
        usuarioId: 'u',
        usuarioRotulo: 'gfin',
        sessaoUid: 's',
        ip: null,
        funcionalidade: 'cad.teste',
        titulo: 'Teste',
        formato: 'csv',
        parametros: {},
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => void updates.push(data),
    },
  };
  const cliente = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>, o: unknown) => {
      opcoes.push(o);
      return fn(tx);
    },
  } as unknown as PrismaClient;
  return { cliente, updates, opcoes };
}

const gerador =
  (linhas: number): GeradorExportacao =>
  async () =>
    ok({ planilha: { nome: 'Teste', colunas: [{ titulo: 'A', tipo: 'texto' }], linhas: Array.from({ length: linhas }, () => ['x']) }, filtros: [] });

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(auditar).mockClear();
});

describe('criarTrabalhadorExportacao', () => {
  it('a transação da geração tem 5 minutos (o padrão do Prisma, 5 s, não basta)', async () => {
    const { cliente, opcoes } = clienteFalso();
    await criarTrabalhadorExportacao({ cliente, geradores: { 'cad.teste': gerador(1) }, agora: () => new Date() })({ pedidoId: PEDIDO });
    expect(opcoes).toEqual([{ timeout: 5 * 60_000 }]);
  });

  it(`exatamente ${LIMITE_EXPORTACAO_ASSINCRONA} linhas (acima do limite síncrono): PRONTA, com o Histórico`, async () => {
    const { cliente, updates } = clienteFalso();
    await criarTrabalhadorExportacao({ cliente, geradores: { 'cad.teste': gerador(LIMITE_EXPORTACAO_ASSINCRONA) }, agora: () => new Date() })({ pedidoId: PEDIDO });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ situacao: 'PRONTA', registros: LIMITE_EXPORTACAO_ASSINCRONA });
    expect(auditar).toHaveBeenCalledTimes(1);
  });

  it(`acima de ${LIMITE_EXPORTACAO_ASSINCRONA} linhas: FALHOU com o teto na mensagem, sem Histórico`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cliente, updates } = clienteFalso();
    await criarTrabalhadorExportacao({ cliente, geradores: { 'cad.teste': gerador(LIMITE_EXPORTACAO_ASSINCRONA + 1) }, agora: () => new Date() })({ pedidoId: PEDIDO });
    expect(updates).toEqual([
      expect.objectContaining({
        situacao: 'FALHOU',
        erro: `A exportação tem ${LIMITE_EXPORTACAO_ASSINCRONA + 1} linhas; o máximo é ${LIMITE_EXPORTACAO_ASSINCRONA}. Use filtros para reduzir.`,
      }),
    ]);
    expect(auditar).not.toHaveBeenCalled();
  });
});
