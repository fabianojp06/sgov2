import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VALOR_MASCARADO as MASCARA_CAD } from '@/modules/cad';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import { VALOR_MASCARADO } from '../domain/mascara-historico';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({ situacao: 'RASCUNHO' as 'RASCUNHO' | 'EM_APROVACAO', origem: 'IMPORTACAO', cc: '4.3.0' }));
// A máscara é do servidor (listarPosicoes): o falso imita, com salário e anual nulos sem incluir/alterar.
vi.mock('@/modules/orc', async (original) => {
  const editavel = () => caso.situacao === 'RASCUNHO';
  const ve = (ctx: ContextoRequisicao) => ctx.permissoes.has('orc.posicoes:incluir') || ctx.permissoes.has('orc.posicoes:alterar');
  const p = (ctx: ContextoRequisicao) => ({
    id: 'p1', cc: caso.cc, cargo: 'Analista de orçamento', quantidade: 1, salarioMensal: ve(ctx) ? Dinheiro.de('7321.45') : null,
    mesInicio: 3, mesSaida: 12, observacao: null, origem: caso.origem, versao: 2, valorAnual: ve(ctx) ? Dinheiro.de('98765.43') : null,
  });
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', versao: 0 }],
    listarPosicoes: async (ctx: ContextoRequisicao) => ({ posicoes: [p(ctx)], editavel: editavel(), veSalario: ve(ctx) }),
    opcoesPosicao: async () => ({
      ccs: [{ classificacao: '4.3.0', descricao: 'Gabinete' }], quantidadeMaxima: 9999,
      situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', editavel: editavel(),
    }),
  };
});

const { default: Posicoes } = await import('../../../app/(sistema)/orc/posicoes/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const TUDO = ['orc.posicoes:consultar', 'orc.posicoes:incluir', 'orc.posicoes:alterar', 'orc.posicoes:excluir'];
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.situacao = 'RASCUNHO';
  caso.origem = 'IMPORTACAO';
  caso.cc = '4.3.0';
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Posicoes({ searchParams: Promise.resolve(busca) }));

describe('página de posições de pessoal', () => {
  it('sem orc.posicoes:consultar: 404 com a negação auditada', async () => {
    contexto = ctx(['orc.orcamento:consultar']);
    expect(await digest(Posicoes({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['orc.posicoes']);
  });

  it('DIREX/Auditor (só consultar): salário e anual mascarados, sem total, sem ações e sem formulário', async () => {
    contexto = ctx(['orc.posicoes:consultar']);
    const h = await html();
    expect(VALOR_MASCARADO).toBe(MASCARA_CAD);
    expect(h).toContain('Posições do CC 4.3.0');
    expect(h).toContain('Analista de orçamento');
    expect(h.split(VALOR_MASCARADO)).toHaveLength(3);
    expect(h).not.toContain('7.321,45');
    expect(h).not.toContain('98.765,43');
    expect(h).not.toContain('Total do CC');
    expect(h).not.toContain('Excluir posição 1');
    expect(h).not.toContain('Nova posição');
  });

  it('Gestor/GFIN: valores em claro, formulário de inclusão com a prévia; com ?editar=, a linha destacada e o aviso da origem', async () => {
    contexto = ctx(TUDO);
    const nova = await html();
    expect(nova).toContain('7.321,45');
    expect(nova).toContain('98.765,43');
    expect(nova).toContain('março a dezembro');
    expect(nova).toContain('Nova posição');
    expect(nova).toContain('Excluir posição 1: Analista de orçamento');
    expect(nova).toContain('Preencha a quantidade, o salário mensal e os meses de início e de saída para ver a prévia.');
    const edicao = await html({ editar: 'p1' });
    expect(edicao).toContain('Alterar posição');
    expect(edicao).toContain('aria-current="true"');
    expect(edicao).toContain('value="7.321,45"');
    expect(edicao).toContain('Esta posição não foi lançada pela tela: uma nova importação deste CC a substitui.');
  });

  it('aviso de origem: a cópia também; a da tela não tem aviso', async () => {
    contexto = ctx(TUDO);
    caso.origem = 'COPIA';
    expect(await html({ editar: 'p1' })).toContain('Esta posição não foi lançada pela tela');
    caso.origem = 'TELA';
    expect(await html({ editar: 'p1' })).not.toContain('Esta posição não foi lançada pela tela');
  });

  it('exercício fechado: só leitura, com a mensagem da situação', async () => {
    contexto = ctx(TUDO);
    caso.situacao = 'EM_APROVACAO';
    const h = await html({ editar: 'p1' });
    expect(h).toContain('Este exercício não pode ser alterado na situação Em Aprovação.');
    expect(h).not.toContain('Nova posição');
    expect(h).not.toContain('Alterar posição');
    expect(h).not.toContain('Excluir posição 1');
  });
});
