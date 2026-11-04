import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import { calcularPainel } from '../domain/resultado';

// Formulário do teto na página (Task 7): só com alterar, sem escopo e com o exercício editável.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({ escopo: 'TOTAL' as 'TOTAL' | 'SUBARVORE', editavel: true, deps: undefined as unknown }));
vi.mock('@/modules/orc', async (original) => ({
  ...(await original<typeof import('@/modules/orc')>()),
  listarExercicios: async () => [],
  obterVisaoExercicio: async (_ctx: unknown, _ano: unknown, _cc: unknown, deps?: unknown) => {
    caso.deps = deps;
    const m12 = Array.from({ length: 12 }, () => Dinheiro.de('10'));
    return {
      exercicio: { id: 'e1', ano: 2027, situacao: 'EM_ELABORACAO', rotuloSituacao: 'Em Elaboração', editavel: caso.editavel, versao: 1, premissasDesatualizadas: false },
      escopo: caso.escopo === 'TOTAL' ? { tipo: 'TOTAL' } : { tipo: 'SUBARVORE', raiz: '4.3', ccs: new Set<string>() },
      painel: caso.escopo === 'TOTAL' ? { ...calcularPainel(m12, [], null), semaforo: null, justificativaTeto: null } : null,
      arvore: [],
      indicadores: { orcamentoAno: Dinheiro.zero(), pessoal: Dinheiro.zero(), percentualPessoal: null, pacotes: 0, empregadosDezembro: 0, porPrioridade: { ESSENCIAL: Dinheiro.zero(), IMPORTANTE: Dinheiro.zero(), DESEJAVEL: Dinheiro.zero() } },
      detalhe: null,
      avisos: [],
    };
  },
}));
const { default: Pagina } = await import('../../../app/(sistema)/orc/orcamento/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
beforeEach(() => {
  caso.escopo = 'TOTAL';
  caso.editavel = true;
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async () => undefined);
});
const html = async () => renderToString((await Pagina({ searchParams: Promise.resolve({}) })) as Parameters<typeof renderToString>[0]);
void createElement;

describe('formulário do teto na página', () => {
  it('GFIN (alterar), sem escopo e editável: formulário e Recalcular', async () => {
    contexto = ctx(['orc.orcamento:consultar', 'orc.orcamento:alterar']);
    const h = await html();
    expect(h).toContain('Teto manual (R$; vazio = padrão)');
    expect(h).toContain('Recalcular');
  });

  it('só consultar, exercício fora de edição ou com escopo: sem formulário', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    expect(await html()).not.toContain('Teto manual');
    contexto = ctx(['orc.orcamento:consultar', 'orc.orcamento:alterar']);
    caso.editavel = false;
    expect(await html()).not.toContain('Teto manual');
    caso.editavel = true;
    caso.escopo = 'SUBARVORE';
    const h = await html();
    expect(h).not.toContain('Teto manual');
    expect(h).not.toContain('Teto e resultado');
  });
});

// A página injeta o semáforo real do cad (#234): sem ele, a visão sai com o aviso de indisponível.
it('a página passa o provedorSemaforo do cad para a visão', async () => {
  contexto = ctx(['orc.orcamento:consultar']);
  await html();
  const { provedorSemaforo } = await import('@/modules/cad');
  expect((caso.deps as { semaforo?: unknown } | undefined)?.semaforo).toBe(provedorSemaforo);
});
