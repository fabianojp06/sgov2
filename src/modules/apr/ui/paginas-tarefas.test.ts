import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import type { TarefaTela } from '../application/solicitacoes';
import { MENSAGENS_APR as M } from '../domain/solicitacao';

// Página da Central de Tarefas (US-078; plano do P26, Task 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';
const caso = vi.hoisted(() => ({ filtros: [] as unknown[], iaLiberada: false }));

const tarefa = (extra: Partial<TarefaTela>): TarefaTela => ({
  id: T1,
  fluxo: 'WA01',
  descricao: 'TP 2027/001 · Versão 2',
  solicitante: 'Ana Orçamentista',
  papelAprovador: 'TITULAR',
  situacao: 'EM_APROVACAO',
  enviadaEm: new Date('2026-11-14T12:00:00Z'),
  decididaEm: null,
  justificativa: null,
  versao: 0,
  ...extra,
});

vi.mock('@/modules/apr', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/apr')>()),
    listarTarefas: async (ctx: ContextoRequisicao, filtros: unknown) => {
      exigir(ctx, 'apr.tarefas', 'consultar');
      caso.filtros.push(filtros);
      return [tarefa({}), tarefa({ id: T2, situacao: 'REJEITADO', justificativa: 'Falta o rateio de março.', descricao: 'TP 2027/002 · Versão 1' })];
    },
    obterTarefa: async (ctx: ContextoRequisicao, id: string) => {
      exigir(ctx, 'apr.tarefas', 'consultar');
      return id === T1 ? { tarefa: tarefa({}), resumo: [{ rotulo: 'Valor Global', valor: 'R$ 26.200,00' }] } : null;
    },
  };
});

// A ajuda da IA na recusa (US-084, D-P30-6): a página decide pelo iaLiberada do orc.
vi.mock('@/modules/orc', async (original) => ({
  ...(await original<typeof import('@/modules/orc')>()),
  iaLiberada: async (ctx: ContextoRequisicao, c: string) => c === 'recusa' && caso.iaLiberada && ctx.permissoes.has('orc.ia_recusa:executar'),
}));

const { default: Tarefas } = await import('../../../app/(sistema)/apr/tarefas/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.filtros = [];
  caso.iaLiberada = false;
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
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Tarefas({ searchParams: Promise.resolve(busca) }));

describe('Central de Tarefas', () => {
  it('a lista com o fluxo, o solicitante e o badge; os filtros', async () => {
    contexto = ctx(['apr.tarefas:consultar', 'apr.tarefas:executar']);
    const h = await html({ situacao: 'EM_APROVACAO', tp: '2027' });
    expect(caso.filtros).toEqual([{ situacao: 'EM_APROVACAO', de: undefined, ate: undefined, tp: '2027' }]);
    expect(h).toContain(`<a href="/apr/tarefas?abrir=${T1}">TP 2027/001 · Versão 2</a>`);
    expect(h).toContain('<td>Oficialização de proposta</td><td>Ana Orçamentista</td>');
    expect(h).toContain('>Em Aprovação</span>');
    expect(h).toContain('>Rejeitado</span>');
  });

  it('a tarefa aberta: resumo, Aprovar e Rejeitar com justificativa; sem executar, sem ações', async () => {
    contexto = ctx(['apr.tarefas:consultar', 'apr.tarefas:executar']);
    const h = await html({ abrir: T1 });
    expect(h).toContain('<h2 id="tarefa-aberta">Oficialização de proposta: TP 2027/001 · Versão 2</h2>');
    expect(h).toContain('<dt>Valor Global</dt><dd>R$ 26.200,00</dd>');
    expect(h).toContain('Aprovar: TP 2027/001 · Versão 2');
    expect(h).toContain('name="justificativa"');
    expect(h).toContain('<input type="hidden" name="decisao" value="REJEITAR"/>');
    contexto = ctx(['apr.tarefas:consultar']);
    const s = await html({ abrir: T1 });
    expect(s).not.toContain('name="justificativa"');
    expect(s).not.toContain('Aprovar:');
    expect(await html({ abrir: T2 })).toContain('Solicitação não encontrada na sua Central de Tarefas.');
  });

  it('aviso depois da decisão; sem permissão: 404', async () => {
    contexto = ctx(['apr.tarefas:consultar']);
    expect(await html({ aviso: 'rejeitada', d: 'TP 2027/001 · Versão 2' })).toContain(`<p role="status">${M.REJEITADA('TP 2027/001 · Versão 2').replace(/"/g, '&quot;')}</p>`);
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });

  it('a ajuda da IA na recusa: só no WA01 pendente, com o caso liberado e a permissão (US-084, D-P30-6)', async () => {
    contexto = ctx(['apr.tarefas:consultar', 'apr.tarefas:executar', 'orc.ia_recusa:executar']);
    expect(await html({ abrir: T1 })).not.toContain('Pedir ajuda da IA na justificativa da recusa');
    caso.iaLiberada = true;
    const h = await html({ abrir: T1 });
    expect(h).toContain('Pedir ajuda da IA na justificativa da recusa');
    // A marca da sugestão nasce desligada: só vai junto depois de "Usar este texto".
    expect(h).toContain('<input type="hidden" disabled="" name="sugestaoIa" value="true"/>');
    contexto = ctx(['apr.tarefas:consultar', 'apr.tarefas:executar']);
    expect(await html({ abrir: T1 })).not.toContain('Pedir ajuda da IA');
    contexto = ctx(['apr.tarefas:consultar', 'orc.ia_recusa:executar']);
    expect(await html({ abrir: T1 })).not.toContain('Pedir ajuda da IA');
  });
});
