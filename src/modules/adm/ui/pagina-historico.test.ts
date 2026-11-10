import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Página do Histórico (US-040): guarda, filtros da URL, sem Novo/Alterar/Excluir e os botões por permissão.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const chamada = vi.hoisted(() => ({ filtro: null as unknown }));
vi.mock('@/modules/adm', async (original) => ({
  ...(await original<typeof import('@/modules/adm')>()),
  consultarHistorico: async (_ctx: unknown, filtro: unknown) => {
    chamada.filtro = filtro;
    return { ok: true, valor: { linhas: [{ id: '1', descricao: 'Login realizado', usuario: 'ana', funcionalidade: 'aut.login', ocorridoEm: new Date('2026-11-04T13:00:00Z'), tipo: 'LOGIN' }], total: 51, pagina: 1, porPagina: 50 } };
  },
}));
const { default: Historico } = await import('../../../app/(sistema)/adm/historico/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'adm', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
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
const html = async (q: Record<string, string> = {}) => renderToString((await Historico({ searchParams: Promise.resolve(q) })) as Parameters<typeof renderToString>[0]);
const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));

describe('página do Histórico', () => {
  it('sem adm.historico:consultar → 404 com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Historico({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['adm.historico']);
  });

  it('só consultar: tabela com os campos do UC02.24, paginação, sem Exportar, Imprimir, Novo, Alterar nem Excluir', async () => {
    contexto = ctx(['adm.historico:consultar']);
    const h = await html({ tipo: 'LOGIN', de: '2026-11-01', ate: '2026-11-04' });
    for (const t of ['Data da Operação', 'Usuário', 'Funcionalidade', 'Tipo de Operação', 'Descrição', 'Login realizado', 'página 1 de 2', 'Próxima']) expect(h).toContain(t);
    for (const t of ['Exportar', 'Imprimir', 'Novo', 'Alterar', 'Excluir']) expect(h).not.toContain(`>${t}<`);
    expect(chamada.filtro).toMatchObject({ tipo: 'LOGIN', pagina: 1 });
    expect(h).toContain('href="/adm/historico?tipo=LOGIN&amp;de=2026-11-01&amp;ate=2026-11-04&amp;pagina=2"');
  });

  it('com exportar e imprimir: o link de exportação leva os filtros e o botão aparece', async () => {
    contexto = ctx(['adm.historico:consultar', 'adm.historico:exportar', 'adm.historico:imprimir']);
    const h = await html({ usuario: 'ana', de: '2026-11-01', ate: '2026-11-04' });
    expect(h).toContain('href="/adm/historico/exportar?usuario=ana&amp;de=2026-11-01&amp;ate=2026-11-04"');
    expect(h).toContain('>Imprimir<');
  });

  it('exportação agendada (US-024): aviso com o link para o pedido em Minhas exportações; pedido inválido não vira link', async () => {
    contexto = ctx(['adm.historico:consultar', 'adm.historico:exportar']);
    const id = '0b7f9c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
    const h = await html({ aviso: 'exportacao-agendada', pedido: id });
    expect(h).toContain('está sendo gerada em segundo plano');
    expect(h).toContain(`href="/rel/exportacoes?pedido=${id}"`);
    expect(h).toContain('>Abrir Minhas exportações<');
    const ruim = await html({ aviso: 'exportacao-agendada', pedido: 'https://exemplo.org' });
    expect(ruim).not.toContain('/rel/exportacoes');
  });

  it('recusas da exportação: acima do teto e pedidos demais em geração', async () => {
    contexto = ctx(['adm.historico:consultar', 'adm.historico:exportar']);
    expect(await html({ aviso: 'exportacao-recusada' })).toContain('passa de 100.000 linhas');
    expect(await html({ aviso: 'exportacao-pendentes' })).toContain('exportações em geração');
    expect(await html({ aviso: 'toString' })).not.toContain('role="alert"');
  });
});
