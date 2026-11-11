import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { FilaGerenciada } from '@/shared/filas';
import { registrarTrabalhadoresOrc } from './servidor';

// O registro do trabalhador do revisor (US-064) no worker: a fila orc.revisar, e o pedido fora do
// formato é descartado com o log, sem ler o banco nem voltar para a fila.
afterEach(() => vi.restoreAllMocks());

describe('registrarTrabalhadoresOrc', () => {
  it('registra orc.revisar; pedido fora do formato: [ORC_REVISAO_PEDIDO_INVALIDO], sem tocar no banco', async () => {
    const tratadores = new Map<string, (d: unknown) => Promise<void>>();
    const fila = { registrarTrabalhador: vi.fn(async (nome: string, h: (d: unknown) => Promise<void>) => void tratadores.set(nome, h)) } as unknown as FilaGerenciada;
    const cliente = new Proxy({}, { get: () => { throw new Error('não devia ler o banco'); } }) as PrismaClient;
    await registrarTrabalhadoresOrc(fila, { cliente });
    expect([...tratadores.keys()]).toEqual(['orc.revisar']);
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(String(a[0])));
    await expect(tratadores.get('orc.revisar')!({ outro: 1 })).resolves.toBeUndefined();
    // Id fora do formato uuid: nada a processar.
    await expect(tratadores.get('orc.revisar')!({ revisaoId: 'x' })).resolves.toBeUndefined();
    expect(logs).toEqual(['[ORC_REVISAO_PEDIDO_INVALIDO]']);
  });
});

describe('contrato do layout (gerador da carga, #138)', () => {
  it('expõe o layout ADMC-ORC v1.0, as abas na ordem e os cabeçalhos da importação', async () => {
    const s = await import('./servidor');
    expect(s.LAYOUT).toBe('ADMC-ORC v1.0');
    expect(s.ABAS).toEqual(['Pessoal', 'Pacotes base zero', 'Receitas']);
    expect(s.ABA_INSTRUCOES).toBe('Instruções');
    expect(s.CELULA_LAYOUT).toBe('E1');
    expect(s.LINHA_CABECALHO_MAX).toBe(4);
    expect(s.COLUNAS_PESSOAL).toEqual(['CC analítico', 'Cargo', 'Quantidade', 'Salário mensal (R$)', 'Mês de início (1–12)', 'Mês de saída (1–12)', 'Observação']);
    expect(s.COLUNAS_PACOTES).toEqual([
      'CC analítico',
      'Conta analítica',
      'Atividade / justificativa (mín. 10 caracteres)',
      'Prioridade',
      'Quantidade',
      'Valor unitário (R$)',
      'Corrigir pelo IPCA?',
      'Distribuição',
      'Mês (se pontual)',
    ]);
    expect(s.COLUNAS_RECEITAS[0]).toBe('TP / versão');
    expect(s.RAIZES_CONTAS_PESSOAL).toEqual(['4.1.1.1', '4.1.1.2']);
  });
});
