import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro, Percentual } from '@/shared/kernel';

// Página do Consolidado dos TPs (US-101; plano do P31, Task 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    obterConsolidado: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.consolidado', 'consultar');
      return {
        linhas: [
          { numero: 'TP-C01/2027', objeto: 'Programa A', tipo: 'Termo de Parceria', situacao: 'RASCUNHO', versaoAtual: 1, versaoOficial: null, orcado: null, realizado: Dinheiro.zero(), percentual: null },
          {
            numero: 'TP-C02/2027',
            objeto: 'Programa B',
            tipo: 'Termo de Parceria',
            situacao: 'OFICIALIZADO',
            versaoAtual: 2,
            versaoOficial: 2,
            orcado: Dinheiro.de('1234.56'),
            realizado: Dinheiro.zero(),
            percentual: Percentual.razao(Dinheiro.zero(), Dinheiro.de('1234.56')),
          },
        ],
        totalOrcado: Dinheiro.de('1234.56'),
        totalRealizado: Dinheiro.zero(),
        percentual: Percentual.razao(Dinheiro.zero(), Dinheiro.de('1234.56')),
        oficializados: 1,
      };
    },
  };
});

const { default: Consolidado } = await import('../../../app/(sistema)/orc/consolidado/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) =>
  p.then(
    () => 'sem erro',
    (e: { digest?: string }) => e.digest ?? String(e),
  );

describe('página do Consolidado dos TPs', () => {
  it('todos os TPs, o oficial com o valor e o não oficializado sem; o total; sem link para o TP (D-P31-4)', async () => {
    contexto = ctx(['orc.consolidado:consultar']);
    const h = renderToStaticMarkup(await Consolidado());
    expect(h).toContain('TP-C01/2027 – Programa A');
    expect(h).toContain('Não oficializado');
    expect(h).toContain('Versão 2</td><td>1.234,56</td><td>0,00</td><td>0,00%</td>');
    expect(h).toContain('Total dos 1 TP(s) oficializado(s)');
    expect(h).not.toContain('href="/orc/');
  });

  it('sem a permissão própria: 404, mesmo com a das propostas', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(Consolidado())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});
