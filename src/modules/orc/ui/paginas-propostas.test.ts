import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';

// Página das propostas de TP (US-065; plano do P17, Task 2, Step 1), com duplicar e nova versão (US-066;
// plano do P18, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const ID = '00000000-0000-4000-8000-0000000000a1';
const ID_OFICIALIZADA = '00000000-0000-4000-8000-0000000000a2';
const caso = vi.hoisted(() => ({
  ccsLivres: [] as { classificacao: string; descricao: string }[],
  chamadasCcs: 0,
  chamadasDuplicar: [] as string[],
}));
vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarPropostas: async (ctx: ContextoRequisicao) => {
      exigir(ctx, 'orc.propostas', 'consultar');
      return [
        {
          id: ID,
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
        {
          id: ID_OFICIALIZADA,
          numero: 'TP-2027/002',
          tipo: 'CONTRATO',
          objeto: 'Contrato oficializado',
          parceiro: 'Parceiro',
          inicio: '2027-01-01',
          fim: '2027-12-31',
          categoria: 'META',
          cc: '9.4',
          situacao: 'OFICIALIZADO',
          versaoAtual: 2,
          valorGlobal: Dinheiro.zero(),
          versao: 5,
        },
      ];
    },
    dadosParaDuplicar: async (ctx: ContextoRequisicao, id: string) => {
      exigir(ctx, 'orc.propostas', 'incluir');
      caso.chamadasDuplicar.push(id);
      if (id !== ID) return null;
      return {
        origemId: ID,
        versaoOrigem: 3,
        numeroOrigem: 'TP-2027/001',
        tipo: 'TERMO_PARCERIA',
        objeto: 'Cópia de Apoio à gestão orçamentária',
        parceiro: null,
        inicio: '2027-01-01',
        fim: '2027-12-31',
        categoria: 'CONSOLIDADA',
      };
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
  caso.chamadasDuplicar = [];
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
      '<th scope="row">TP-2027/001</th><td>Termo de Parceria</td><td>Apoio à gestão orçamentária</td><td>Consolidada</td><td>01/01/2027 a 31/12/2027</td><td>9.1</td><td>1</td><td><span class="selo">Rascunho</span></td><td>0,00</td>',
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

  it('a coluna Versão mostra o número da última versão; "Nova versão" só na última em Rascunho ou Em Elaboração; "Duplicar" em todas', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html();
    expect(h).toContain('<th scope="col">Versão</th>');
    expect(h).toMatch(/<th scope="row">TP-2027\/002<\/th>(<td>[^<]*<\/td>){5}<td>2<\/td><td><span class="selo">Oficializado<\/span>/);
    expect(h).toContain('Nova versão da proposta TP-2027/001');
    expect(h).not.toContain('Nova versão da proposta TP-2027/002');
    expect(h).not.toContain('Excluir a proposta TP-2027/002');
    expect(h).toContain(`<a href="/orc/propostas?duplicar=${ID}">Duplicar a proposta TP-2027/001</a>`);
    expect(h).toContain(`<a href="/orc/propostas?duplicar=${ID_OFICIALIZADA}">Duplicar a proposta TP-2027/002</a>`);
    expect(caso.chamadasDuplicar).toEqual([]);
  });

  it('?duplicar=<id>: o formulário de duplicar com os campos da origem, o Número em branco e o CC só com os livres; sem o "Nova proposta"', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html({ duplicar: ID });
    expect(caso.chamadasDuplicar).toEqual([ID]);
    expect(h).toContain('Duplicar a proposta do TP TP-2027/001');
    expect(h).not.toContain('Nova proposta</h2>');
    expect(h).toMatch(/<input type="hidden" name="origemId" value="00000000-0000-4000-8000-0000000000a1"\/>/);
    expect(h).toMatch(/<input type="hidden" name="versaoOrigem" value="3"\/>/);
    expect(h).toMatch(/<option value="TERMO_PARCERIA" selected="">Termo de Parceria<\/option>/);
    expect(h).toMatch(/<option value="CONSOLIDADA" selected="">Consolidada<\/option>/);
    expect(h).toMatch(/<textarea id="duplicar-proposta-objeto" name="objeto"[^>]*>Cópia de Apoio à gestão orçamentária<\/textarea>/);
    expect(h).toMatch(/<input id="duplicar-proposta-numero"(?![^>]*value=)[^>]*name="numero"\/>/);
    expect(h).toMatch(/<input id="duplicar-proposta-inicio"[^>]*type="date"[^>]*value="2027-01-01"/);
    expect(h).toMatch(/<input id="duplicar-proposta-fim"[^>]*type="date"[^>]*value="2027-12-31"/);
    const seletor = /<select id="duplicar-proposta-cc"[^>]*>(.*?)<\/select>/.exec(h)?.[1] ?? '';
    expect([...seletor.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', '9.2', '9.3']);
    expect(h).toContain('Duplicar proposta</button>');
    expect(h).toContain('<a href="/orc/propostas">Cancelar</a>');
  });

  it('?duplicar com proposta que não se vê: a mensagem de inexistente e o "Nova proposta" de sempre', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html({ duplicar: 'outra' });
    expect(h).toContain('Proposta não encontrada.');
    expect(h).toContain('Nova proposta</h2>');
    expect(h).not.toContain('name="origemId"');
  });

  it('?duplicar sem CC de TP livre: a mensagem e nenhum formulário', async () => {
    contexto = ctx(ORCAMENTISTA);
    caso.ccsLivres = [];
    const h = await html({ duplicar: ID });
    expect(h).toContain('Não há centro de custo de TP livre.');
    expect(h).not.toContain('<form');
  });

  it('os avisos depois de duplicar e de criar nova versão', async () => {
    contexto = ctx(ORCAMENTISTA);
    expect(await html({ aviso: 'duplicada', tp: 'TP-2027/009' })).toContain('<p role="status">Proposta do TP TP-2027/009 criada em Rascunho, por duplicação.</p>');
    expect(await html({ aviso: 'versao', tp: 'TP-2027/001' })).toContain('<p role="status">Nova versão da proposta do TP TP-2027/001 criada em Rascunho.</p>');
  });

  it('Auditor (só consultar): a lista, sem formulário nem Excluir, e sem ler os CCs livres', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    const h = await html({ duplicar: ID });
    expect(h).not.toContain('Nova versão');
    expect(h).not.toContain('Duplicar');
    expect(caso.chamadasDuplicar).toEqual([]);
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
