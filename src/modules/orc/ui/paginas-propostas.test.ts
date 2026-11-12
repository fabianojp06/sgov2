import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';

// Página das propostas de TP (US-065; plano do P17, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const caso = vi.hoisted(() => ({
  ccsLivres: [] as { classificacao: string; descricao: string }[],
  chamadasCcs: 0,
}));
vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarPropostas: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.propostas', 'consultar');
      return [
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          numero: 'TP-2027/001',
          tipo: 'TERMO_PARCERIA',
          objeto: 'Apoio à gestão orçamentária',
          parceiro: null,
          inicio: '2027-01-01',
          fim: '2027-12-31',
          categoria: 'CONSOLIDADA',
          cc: '9.1',
          situacao: 'RASCUNHO',
          versaoAtual: 1,
          valorGlobal: Dinheiro.zero(),
          versao: 3,
        },
      ];
    },
    ccsLivresParaTp: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.propostas', 'incluir');
      caso.chamadasCcs++;
      return caso.ccsLivres;
    },
  };
});

const { default: Propostas } = await import('../../../app/(sistema)/orc/propostas/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const ORCAMENTISTA = ['orc.propostas:consultar', 'orc.propostas:incluir', 'orc.propostas:excluir'];
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.ccsLivres = [
    { classificacao: '9.2', descricao: 'TP sintético 2' },
    { classificacao: '9.3', descricao: 'TP sintético 3' },
  ];
  caso.chamadasCcs = 0;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Propostas({ searchParams: Promise.resolve(busca) }));

describe('página das propostas de TP', () => {
  it('Orçamentista: a lista com o selo Rascunho e o valor global 0,00, o Excluir e o formulário com só os CCs livres', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html();
    expect(h).toContain(
      '<th scope="row">TP-2027/001</th><td>Termo de Parceria</td><td>Apoio à gestão orçamentária</td><td>Consolidada</td><td>01/01/2027 a 31/12/2027</td><td>9.1</td><td><span class="selo">Rascunho</span></td><td>0,00</td>',
    );
    expect(h).toContain('Excluir a proposta TP-2027/001');
    expect(h).toContain('Nova proposta');
    const seletor = /<select id="nova-proposta-cc"[^>]*>(.*?)<\/select>/.exec(h)?.[1] ?? '';
    expect([...seletor.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', '9.2', '9.3']);
    expect(h).toMatch(/<input id="nova-proposta-valor" readOnly="" [^>]*value="0,00"\/>/);
    expect(h).not.toMatch(/name="valorGlobal"/);
    expect(h).toContain('type="date"');
  });

  it('o aviso depois de criar e de excluir, com o número do TP', async () => {
    contexto = ctx(ORCAMENTISTA);
    expect(await html({ aviso: 'incluida', tp: 'TP-2027/001' })).toContain('<p role="status">Proposta do TP TP-2027/001 criada em Rascunho.</p>');
    expect(await html({ aviso: 'excluida', tp: 'TP-2027/001' })).toContain('<p role="status">Proposta do TP TP-2027/001 excluída.</p>');
    expect(await html({ aviso: 'outro', tp: 'X' })).not.toMatch(/<p role="status">Proposta/);
    expect(await html({ aviso: 'incluida' })).not.toMatch(/<p role="status">Proposta/);
  });

  it('sem CC de TP livre: a mensagem e nenhum formulário', async () => {
    contexto = ctx(ORCAMENTISTA);
    caso.ccsLivres = [];
    const h = await html();
    expect(h).toContain('Não há centro de custo de TP livre. Peça à GFIN para cadastrar o CC do novo TP.');
    expect(h).not.toContain('Nova proposta');
    expect(h).not.toContain('<form');
  });

  it('Auditor (só consultar): a lista, sem formulário nem Excluir, e sem ler os CCs livres', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    const h = await html();
    expect(h).toContain('<th scope="row">TP-2027/001</th>');
    expect(h).not.toContain('Nova proposta');
    expect(h).not.toContain('Excluir');
    expect(h).not.toContain('<form');
    expect(caso.chamadasCcs).toBe(0);
  });

  it('sem orc.propostas:consultar: 404 com a negação auditada', async () => {
    contexto = ctx(['orc.posicoes:consultar']);
    expect(await digest(Propostas({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['orc.propostas']);
  });
});
