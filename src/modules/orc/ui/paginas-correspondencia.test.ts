import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Página da correspondência do cargo em texto com o cadastro de C&S (US-056, #410; plano do P16, Task 2).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const C001 = '00000000-0000-4000-8000-000000000001';
const caso = vi.hoisted(() => ({
  situacao: 'RASCUNHO' as 'RASCUNHO' | 'EM_APROVACAO',
  itens: [] as { texto: string; posicoes: number; ccs: number; salarioMinimo: string; salarioMaximo: string; sugestaoId: string | null }[],
  comSalario: false,
  subarvore: false,
}));
vi.mock('@/modules/orc', async (original) => {
  const { ErroPermissao: Negada } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', versao: 7 }],
    listarCorrespondencias: async () => {
      if (caso.subarvore) throw new Negada('orc.posicoes', 'alterar');
      const editavel = caso.situacao === 'RASCUNHO';
      return {
        versao: 7,
        editavel,
        rotuloSituacao: editavel ? 'Rascunho' : 'Em Aprovação',
        itens: editavel ? caso.itens : [],
        cargos: {
          cargos: editavel
            ? [{ id: C001, codigo: 'C001', nome: 'Analista de orçamento', salarioFonteAtiva: caso.comSalario ? '7500.00' : null, faixa: null }]
            : [],
          comSalario: caso.comSalario,
          aviso: caso.comSalario ? null : 'O salário da Fonte Ativa não aparece para o seu perfil. Informe o salário mensal.',
        },
      };
    },
  };
});

const { default: Correspondencia } = await import('../../../app/(sistema)/orc/posicoes/correspondencia/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const GFIN = ['orc.posicoes:consultar', 'orc.posicoes:incluir', 'orc.posicoes:alterar', 'orc.posicoes:excluir'];
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const ITEM = { texto: 'analista de orcamento', posicoes: 3, ccs: 2, salarioMinimo: '7000.00', salarioMaximo: '8100.50', sugestaoId: C001 };

beforeEach(() => {
  caso.situacao = 'RASCUNHO';
  caso.itens = [ITEM, { ...ITEM, texto: 'Analista Orç.', posicoes: 1, ccs: 1, salarioMaximo: '7000.00', sugestaoId: null }];
  caso.comSalario = false;
  caso.subarvore = false;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Correspondencia({ searchParams: Promise.resolve(busca) }));

describe('página da correspondência do cargo em texto', () => {
  it('GFIN: um texto por linha com posições, CCs e salário gravado; a sugestão pré-escolhida; sem sugestão, o botão desabilitado', async () => {
    contexto = ctx(GFIN);
    const h = await html();
    expect(h).toContain('Cargos em texto (2027)');
    expect(h).toContain('<th scope="row">analista de orcamento</th><td>3</td><td>2</td><td>7.000,00 a 8.100,50</td>');
    expect(h).toContain('<td>7.000,00</td>');
    expect(h).toMatch(new RegExp(`<option value="${C001}" selected="">C001 – Analista de orçamento</option>`));
    expect(h).toContain('Ligar analista de orcamento');
    expect(h).toMatch(/<button type="button" disabled="">Ligar Analista Orç\.<\/button>/);
    expect(h).not.toContain('Fonte Ativa R$');
    expect(h).toContain('<p role="note">A Fonte Ativa dos cargos não aparece para o seu perfil')
  });

  it('com cad.salarios (comSalario): a Fonte Ativa no rótulo do cargo', async () => {
    contexto = ctx(GFIN);
    caso.comSalario = true;
    const h = await html();
    expect(h).toContain('C001 – Analista de orçamento · Fonte Ativa R$ 7.500,00');
    expect(h).not.toContain('role="note"');
  });

  it('o aviso depois de ligar; a lista vazia', async () => {
    contexto = ctx(GFIN);
    expect(await html({ ligadas: '3' })).toContain('<p role="status">3 posições ligadas ao cargo do cadastro.</p>');
    expect(await html({ ligadas: 'x' })).not.toContain('ligadas ao cargo');
    caso.itens = [];
    expect(await html()).toContain('Nenhuma posição com cargo em texto neste exercício.');
  });

  it('exercício fechado: a mensagem da situação e nenhum botão', async () => {
    contexto = ctx(GFIN);
    caso.situacao = 'EM_APROVACAO';
    const h = await html();
    expect(h).toContain('Este exercício não pode ser alterado na situação Em Aprovação.');
    expect(h).not.toContain('Ligar ');
  });

  it('sem orc.posicoes:alterar ou com escopo de subárvore: 404 com a negação auditada', async () => {
    contexto = ctx(['orc.posicoes:consultar']);
    expect(await digest(Correspondencia({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    contexto = ctx(GFIN);
    caso.subarvore = true;
    expect(await digest(Correspondencia({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    // A janela de negações junta as duas do mesmo usuário e funcionalidade.
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['orc.posicoes']);
  });
});
