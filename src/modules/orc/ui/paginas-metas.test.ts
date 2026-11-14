import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { BlocoMetas, FiltrosMetas } from '../application/metas';

// Página das metas da proposta (US-067; plano do P19, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P_META = '00000000-0000-4000-8000-0000000000b1';
const P_APROVACAO = '00000000-0000-4000-8000-0000000000b2';
const P_CONSOLIDADA = '00000000-0000-4000-8000-0000000000b3';
const M1 = '00000000-0000-4000-8000-0000000000c1';
const M2 = '00000000-0000-4000-8000-0000000000c2';
const caso = vi.hoisted(() => ({ filtros: [] as unknown[] }));

const bloco = (extra: Partial<BlocoMetas>): BlocoMetas => ({
  propostaId: P_META,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  tipo: 'TERMO_PARCERIA',
  categoria: 'META',
  versaoNumero: 2,
  situacao: 'RASCUNHO',
  editavel: true,
  versaoCapa: 7,
  valorGlobal: Dinheiro.zero(),
  valorGlobalSemPessoal: false,
  totalMetas: Dinheiro.de('1234.56'),
  saldo: Dinheiro.de('-1234.56'),
  metas: [
    { id: M1, numero: 'M1', nome: 'Oficinas', valor: Dinheiro.de('1234.56'), status: 'ATIVO', observacao: 'Nota', versao: 3 },
    { id: M2, numero: 'M2', nome: 'Parada', valor: Dinheiro.de('10'), status: 'INATIVO', observacao: null, versao: 0 },
  ],
  ...extra,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarMetas: async (ctx: ContextoRequisicao, filtros: FiltrosMetas) => {
      exigir(ctx, 'orc.metas', 'consultar');
      caso.filtros.push(filtros);
      return [
        bloco({}),
        bloco({ propostaId: P_APROVACAO, numero: 'TP-2027/002', objeto: 'Em aprovação', situacao: 'EM_APROVACAO', editavel: false, metas: [] }),
        bloco({ propostaId: P_CONSOLIDADA, numero: 'TP-2027/003', objeto: 'Consolidada', tipo: 'CONTRATO', categoria: 'CONSOLIDADA', editavel: false, metas: [] }),
      ];
    },
  };
});

const { default: Metas } = await import('../../../app/(sistema)/orc/metas/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const ORCAMENTISTA = ['orc.metas:consultar', 'orc.metas:incluir', 'orc.metas:alterar', 'orc.metas:excluir'];
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.filtros = [];
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Metas({ searchParams: Promise.resolve(busca) }));
/** O trecho do bloco de uma proposta (até o próximo bloco). */
const trecho = (h: string, id: string) => {
  const inicio = h.indexOf(`<section aria-labelledby="metas-${id}"`);
  const fim = h.indexOf('<section aria-labelledby="metas-', inicio + 1);
  return h.slice(inicio, fim === -1 ? undefined : fim);
};

describe('página das metas da proposta', () => {
  it('Orçamentista: bloco por proposta (RN0137), a grade (RN0135), o total e o saldo (RN0142), as ações e o "Nova meta"', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html();
    const b = trecho(h, P_META);
    expect(b).toContain('TP-2027/001 – Programa de capacitação</h2>');
    expect(b).toContain('Termo de Parceria · Versão 2 <span class="selo">Rascunho</span>');
    expect(b).toContain('<th scope="col">Número</th><th scope="col">Nome</th><th scope="col">Valor global</th><th scope="col">Status</th><th scope="col">Ações</th>');
    expect(b).toContain('<th scope="row">M1</th><td>Oficinas</td><td>1.234,56</td><td>Ativo</td>');
    expect(b).toContain('<th scope="row">M2</th><td>Parada</td><td>10,00</td><td>Inativo</td>');
    expect(b).toContain('<dt>Total das metas ativas (R$)</dt><dd>1.234,56</dd>');
    expect(b).toContain('<dt>Saldo a distribuir (R$)</dt><dd>-1.234,56');
    expect(b).toContain(`<a href="/orc/metas?editar=${M1}">Editar a meta M1</a>`);
    expect(b).toContain('Excluir a meta M1');
    expect(b).toContain(`<a href="/orc/metas?nova=${P_META}">Nova meta na proposta TP-2027/001</a>`);
  });

  it('versão Em Aprovação: sem ações nem "Nova meta"; Consolidada: a nota no lugar da grade (D-P19-2)', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html();
    const a = trecho(h, P_APROVACAO);
    expect(a).toContain('<span class="selo">Em Aprovação</span>');
    expect(a).toContain('Nenhuma meta encontrada nesta versão.');
    expect(a).not.toContain('Nova meta');
    const c = trecho(h, P_CONSOLIDADA);
    expect(c).toContain('<p role="note">Esta proposta não opera por metas: a categoria dela é Consolidada.</p>');
    expect(c).not.toContain('<table');
    expect(c).not.toContain('Nova meta');
  });

  it('os filtros (Tipo, Proposta e Meta) vão ao caso de uso e voltam preenchidos', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html({ tipo: 'CONTRATO', proposta: 'capac', meta: 'ofic' });
    expect(caso.filtros).toEqual([{ tipo: 'CONTRATO', proposta: 'capac', meta: 'ofic' }]);
    expect(h).toContain('<form role="search" aria-label="Pesquisar metas" action="/orc/metas" method="get">');
    expect(h).toMatch(/<option value="CONTRATO" selected="">Contrato<\/option>/);
    expect(h).toMatch(/<input id="filtro-proposta" name="proposta" value="capac"\/>/);
    expect(h).toMatch(/<input id="filtro-meta" name="meta" value="ofic"\/>/);
  });

  it('?nova=<proposta>: o formulário com Proposta e Tipo só leitura e sem name (RN0140), a proposta e a versão da capa escondidas', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html({ nova: P_META, meta: 'x' });
    expect(caso.filtros).toEqual([{}]);
    expect(h).toContain('Nova meta na proposta TP-2027/001</h2>');
    expect(h).toMatch(new RegExp(`<input type="hidden" name="propostaId" value="${P_META}"/>`));
    expect(h).toMatch(/<input type="hidden" name="versaoCapa" value="7"\/>/);
    expect(h).toMatch(/<input id="nova-meta-proposta" readOnly="" value="TP-2027\/001 – Programa de capacitação"\/>/);
    expect(h).toMatch(/<input id="nova-meta-tipo" readOnly="" value="Termo de Parceria"\/>/);
    expect(h).toMatch(/<input id="nova-meta-numero"[^>]*name="numero"\/>/);
    expect(h).toMatch(/<option value="ATIVO" selected="">Ativo<\/option>/);
    expect(h).not.toMatch(/<input[^>]*name="tipo"/);
    expect(h).toContain('Incluir meta</button>');
  });

  it('?editar=<meta>: o formulário com o Número só leitura, os valores atuais e o id, a versão da meta e a da capa escondidos', async () => {
    contexto = ctx(ORCAMENTISTA);
    const h = await html({ editar: M1 });
    expect(h).toContain('Alterar a meta M1 da proposta TP-2027/001</h2>');
    expect(h).toMatch(new RegExp(`<input type="hidden" name="id" value="${M1}"/>`));
    expect(h).toMatch(/<input type="hidden" name="versao" value="3"\/>/);
    expect(h).toMatch(/<input type="hidden" name="versaoCapa" value="7"\/>/);
    expect(h).toMatch(/<input id="alterar-meta-numero" readOnly="" value="M1"\/>/);
    expect(h).not.toMatch(/name="numero"/);
    expect(h).toMatch(/<input id="alterar-meta-valor"[^>]*name="valor" value="1.234,56"\/>/);
    expect(h).toMatch(/<textarea id="alterar-meta-observacao"[^>]*>Nota<\/textarea>/);
    expect(h).toContain('Salvar meta</button>');
  });

  it('formulário sobre proposta não editável ou desconhecida: a mensagem, sem formulário', async () => {
    contexto = ctx(ORCAMENTISTA);
    expect(await html({ nova: P_APROVACAO })).toContain('<p role="status">Proposta não encontrada.</p>');
    const h = await html({ editar: 'outra' });
    expect(h).toContain('<p role="status">Meta não encontrada.</p>');
    expect(h).not.toContain('Salvar meta');
  });

  it('os avisos depois de incluir, alterar e excluir', async () => {
    contexto = ctx(ORCAMENTISTA);
    expect(await html({ aviso: 'incluida', m: 'M1' })).toContain('<p role="status">Meta M1 incluída.</p>');
    expect(await html({ aviso: 'alterada', m: 'M1' })).toContain('<p role="status">Meta M1 alterada.</p>');
    expect(await html({ aviso: 'excluida', m: 'M1' })).toContain('<p role="status">Meta M1 excluída.</p>');
    expect(await html({ aviso: 'excluida' })).not.toMatch(/<p role="status">Meta/);
  });

  it('Auditor (só consultar): a grade e os totais, sem ações nem formulário, mesmo com ?nova', async () => {
    contexto = ctx(['orc.metas:consultar']);
    const h = await html({ nova: P_META });
    expect(h).toContain('<th scope="row">M1</th>');
    expect(h).not.toContain('Ações');
    expect(h).not.toContain('Nova meta');
    expect(h).not.toContain('Editar');
    expect(h).not.toContain('Excluir');
    expect(h).not.toMatch(/<form(?! role="search")/);
  });

  it('sem orc.metas:consultar: 404 com a negação auditada', async () => {
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(Metas({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['orc.metas']);
  });
});
