import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { Dinheiro } from '@/shared/kernel';

// Ação da importação (Task 4b): tamanho conferido antes de ler o arquivo; resposta serializável.
const chamadas = vi.hoisted(() => [] as { nome: string; tamanho: number }[]);
vi.mock('./importacao', () => ({
  importarPlanilha: async (_ctx: unknown, e: { arquivo: { nome: string; conteudo: Uint8Array } }) => {
    chamadas.push({ nome: e.arquivo.nome, tamanho: e.arquivo.conteudo.length });
    return { ok: true, valor: { posicoes: 1, pacotes: 0, ccs: 1, receitas: 0, mensagem: 'ok', resumoPorCc: [{ cc: '4.4', posicoes: 1, pacotes: 0, total: Dinheiro.de('180000') }] } };
  },
}));
const { importarPlanilhaAcao } = await import('./acoes-importacao');

const ctx: ContextoRequisicao = { usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(['orc.importacao:executar']) };

beforeEach(() => {
  chamadas.length = 0;
  configurarProvedorContexto({ obter: async () => ctx });
  configurarAuditorNegacao(async () => undefined);
});

const formulario = (bytes: number) => {
  const f = new FormData();
  f.set('exercicioId', 'e1');
  f.set('arquivo', new File([new Uint8Array(bytes)], 'orcamento.xlsx'));
  return f;
};

describe('importarPlanilhaAcao', () => {
  it('arquivo acima de 1 MB: recusado sem chamar a importação', async () => {
    expect(await importarPlanilhaAcao(formulario(1024 * 1024 + 1))).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Arquivo maior que 1 MB.' }] });
    expect(chamadas).toEqual([]);
  });

  it('arquivo dentro do limite: lido e importado; total formatado para a tela', async () => {
    expect(await importarPlanilhaAcao(formulario(10))).toEqual({ ok: true, valor: { mensagem: 'ok', porCc: [{ cc: '4.4', posicoes: 1, pacotes: 0, total: '180.000,00' }] } });
    expect(chamadas).toEqual([{ nome: 'orcamento.xlsx', tamanho: 10 }]);
  });

  it('sem arquivo: erro de entrada', async () => {
    const f = new FormData();
    f.set('exercicioId', 'e1');
    const r = await importarPlanilhaAcao(f);
    expect(r.ok).toBe(false);
  });
});
