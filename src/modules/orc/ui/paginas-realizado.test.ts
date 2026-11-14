import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';

// Página do Realizado (US-085, parte 1; plano do P32, Task 3).
vi.mock('next/server', () => ({ connection: async () => undefined }));

const PROPOSTA = '0b9f1c52-3d1e-4c55-9f4e-2a8f6d1b7c11';
vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    propostasParaRealizado: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.realizado', 'consultar');
      return [{ id: PROPOSTA, numero: 'TP-R01/2026', objeto: 'Programa A' }];
    },
    obterTelaRealizado: async (ctx: ContextoRequisicao, id: string) => {
      exigir(ctx, 'orc.realizado', 'consultar');
      if (id !== PROPOSTA) return null;
      return {
        propostaId: PROPOSTA,
        numero: 'TP-R01/2026',
        objeto: 'Programa A',
        competencias: [
          { competencia: '2026-05', fechada: true, valor: Dinheiro.de('10300') },
          { competencia: '2026-06', fechada: false, valor: Dinheiro.de('2200') },
        ],
        ajustes: [{ conta: '4.1.1.1.001', origem: '2026-05', lancamento: '2026-06', valor: Dinheiro.de('2000') }],
        pendentes: [{ conta: '9.9.9.9.999', competencia: '2026-06', valor: Dinheiro.de('80') }],
        pendencias: { quantidade: 1, valor: Dinheiro.de('80') },
        cargas: [{ arquivo: 'realizado.xlsx', carregadoEm: new Date('2026-11-14T10:00:00Z'), linhas: 3, total: Dinheiro.de('12500'), ajustes: 1, pendencias: 1 }],
        atualizadoEm: new Date('2026-11-14T10:00:00Z'),
        total: Dinheiro.de('12500'),
      };
    },
  };
});

const { default: Realizado } = await import('../../../app/(sistema)/orc/realizado/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Realizado({ searchParams: Promise.resolve(busca) }));

beforeEach(() => {
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('página do Realizado', () => {
  it('sem TP escolhido: a lista para escolher', async () => {
    contexto = ctx(['orc.realizado:consultar']);
    const h = await pagina();
    expect(h).toContain(`href="/orc/realizado?proposta=${PROPOSTA}"`);
    expect(h).toContain('Realizado do TP TP-R01/2026 – Programa A');
  });

  it('o TP: competência fechada e aberta, o ajuste com a origem, a pendência (E3) e a última carga; quem só consulta não carrega nem fecha', async () => {
    contexto = ctx(['orc.realizado:consultar']);
    const h = await pagina({ proposta: PROPOSTA });
    expect(h).toContain('<th scope="row">05/2026</th><td>Fechada</td><td>10.300,00</td>');
    expect(h).toContain('<th scope="row">06/2026</th><td>Aberta</td><td>2.200,00</td>');
    expect(h).toContain('<th scope="row">4.1.1.1.001</th><td>05/2026</td><td>06/2026</td><td>2.000,00</td>');
    expect(h).toContain('Existem 1 valores do ERP sem conta correspondente no SGO (R$ 80,00).');
    expect(h).toContain('Última atualização do realizado: 14/11/2026, 07:00.');
    expect(h).not.toContain('Carregar realizado');
    expect(h).not.toContain('Fechar competência');
    expect(h).not.toContain('Reprocessar pendências');
  });

  it('com executar e aprovar: o formulário da carga e o do fechamento', async () => {
    contexto = ctx(['orc.realizado:consultar', 'orc.realizado:executar', 'orc.realizado:aprovar']);
    const h = await pagina({ proposta: PROPOSTA });
    expect(h).toContain('Carregar realizado');
    expect(h).toContain('Fechar competência');
    expect(h).toContain('não pode ser desfeito');
    expect(h).toContain('Reprocessar pendências');
  });

  it('TP que o usuário não vê: aviso, sem dado', async () => {
    contexto = ctx(['orc.realizado:consultar']);
    expect(await pagina({ proposta: 'outro' })).toContain('Termo de Parceria não encontrado nos seus Termos de Parceria.');
  });

  it('sem a permissão: 404', async () => {
    contexto = ctx(['orc.consolidado:consultar']);
    await expect(pagina()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(negacoes).toHaveLength(1);
  });
});
