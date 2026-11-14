import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { BemTela, BlocoBens, FiltrosBens } from '../application/bens';
import { MENSAGENS_ORC as M } from '../domain/mensagens';

// Página dos bens, serviços e equipamentos da proposta (US-072; plano do P22, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P_META = '00000000-0000-4000-8000-0000000000b1';
const P_APROVACAO = '00000000-0000-4000-8000-0000000000b2';
const M1 = '00000000-0000-4000-8000-0000000000c1';
const B1 = '00000000-0000-4000-8000-0000000000d1';
const B2 = '00000000-0000-4000-8000-0000000000d2';
const caso = vi.hoisted(() => ({ filtros: [] as unknown[], opcoes: 0 }));

const cabecalho = {
  propostaId: P_META,
  numero: 'TP-2027/001',
  objeto: 'Programa de capacitação',
  tipo: 'TERMO_PARCERIA' as const,
  categoria: 'META' as const,
  versaoNumero: 2,
  situacao: 'RASCUNHO' as const,
  editavel: true,
  versaoCapa: 7,
  vigencia: { inicio: '2027-01', fim: '2027-12' },
  metas: [{ id: M1, numero: 'M1', nome: 'Oficinas' }],
};
const bem = (extra: Partial<BemTela>): BemTela => ({
  id: B1,
  metaId: M1,
  meta: 'M1 – Oficinas',
  conta: '4.2.1.1.001',
  descricao: 'Notebook',
  data: '2027-05-10',
  quantidade: 3,
  valorUnitario: Dinheiro.de('1234.56'),
  valorTotal: Dinheiro.de('3703.68'),
  ativo: true,
  copiado: false,
  versao: 0,
  ...extra,
});
const bloco = (extra: Partial<BlocoBens>): BlocoBens => ({
  ...cabecalho,
  grupos: [
    {
      conta: '4.2.1.1.001',
      descricaoConta: 'Computadores',
      itens: [bem({}), bem({ id: B2, descricao: 'Monitor', copiado: true, quantidade: 1, valorUnitario: Dinheiro.de('800.00'), valorTotal: Dinheiro.de('800.00') })],
      subtotal: Dinheiro.de('4503.68'),
    },
  ],
  total: Dinheiro.de('4503.68'),
  inativos: 1,
  listaInativos: [],
  ...extra,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarBens: async (ctx: ContextoRequisicao, filtros: FiltrosBens) => {
      exigir(ctx, 'orc.bens', 'consultar');
      caso.filtros.push(filtros);
      return [bloco({}), bloco({ propostaId: P_APROVACAO, numero: 'TP-2027/002', situacao: 'EM_APROVACAO', editavel: false, grupos: [], total: Dinheiro.zero(), inativos: 0 })];
    },
    opcoesBem: async () => {
      caso.opcoes++;
      return { contas: [{ classificacao: '4.2.1.1.001', descricao: 'Computadores' }] };
    },
  };
});

const { default: Bens } = await import('../../../app/(sistema)/orc/bens/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'].map((a) => `orc.bens:${a}`);
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.filtros = [];
  caso.opcoes = 0;
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
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Bens({ searchParams: Promise.resolve(busca) }));
const trecho = (h: string, id: string) => {
  const inicio = h.indexOf(`<section aria-labelledby="bens-${id}"`);
  const fim = h.indexOf('<section aria-labelledby="bens-', inicio + 1);
  return h.slice(inicio, fim === -1 ? undefined : fim);
};

describe('página dos bens da proposta', () => {
  it('quem lança: grupo por conta com subtotal, total geral, inativos, excluir × inativar e "Novo"', async () => {
    contexto = ctx(LANCA);
    const b = trecho(await html(), P_META);
    expect(b).toContain(`<caption id="bens-${P_META}-4.2.1.1.001-caption">Conta 4.2.1.1.001 – Computadores, valores em R$</caption>`);
    expect(b).toContain(
      '<th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Meta</th><th scope="col">Quantidade</th><th scope="col">Valor unitário</th><th scope="col">Valor total</th><th scope="col">Ações</th>',
    );
    expect(b).toContain('<th scope="row">10/05/2027</th><td>Notebook</td><td>M1 – Oficinas</td><td>3</td><td>1.234,56</td><td>3.703,68</td>');
    expect(b).toContain('<th scope="row" colSpan="5">Subtotal da conta 4.2.1.1.001</th><td>4.503,68</td>');
    expect(b).toContain('<strong>Total geral da proposta:</strong> R$ 4.503,68');
    expect(b).toContain('1 item inativado nesta versão (vieram de versão anterior).');
    expect(b).toContain('Excluir o item Notebook');
    expect(b).toContain('Inativar o item Monitor');
    expect(b).toContain(`<a href="/orc/bens?nova=${P_META}">Novo bem, serviço ou equipamento na proposta TP-2027/001</a>`);
  });

  it('quem só consulta não vê ações; Em Aprovação sem "Novo"', async () => {
    contexto = ctx(['orc.bens:consultar']);
    const h = await html();
    expect(trecho(h, P_META)).not.toContain('Editar');
    expect(trecho(h, P_META)).toContain('3.703,68');
    contexto = ctx(LANCA);
    const h2 = await html();
    expect(trecho(h2, P_APROVACAO)).toContain('Nenhum bem, serviço ou equipamento nesta versão.');
    expect(trecho(h2, P_APROVACAO)).not.toContain('Novo bem');
  });

  it('?nova= abre o formulário com a meta e a conta; ?editar= preenchido; a lista vem sem filtro', async () => {
    contexto = ctx(LANCA);
    const n = await html({ nova: P_META, proposta: 'x' });
    expect(caso.filtros).toEqual([{}]);
    expect(caso.opcoes).toBe(1);
    expect(n).toContain('Novo bem, serviço ou equipamento na proposta TP-2027/001</h2>');
    expect(n).toMatch(/<select id="novo-bem-meta" name="metaId"/);
    expect(n).toContain('<option value="4.2.1.1.001">4.2.1.1.001 – Computadores</option>');
    const e = await html({ editar: B1 });
    expect(e).toContain('Alterar o item &quot;Notebook&quot;</h2>');
    expect(e).toContain('value="1.234,56"');
    expect(e).toContain('value="2027-05-10"');
    expect(e).toMatch(/<select id="alterar-bem-meta" name="metaId"/);
  });

  it('avisos e filtros; sem permissão: 404', async () => {
    contexto = ctx(LANCA);
    expect(await html({ aviso: 'inativado', d: 'Monitor' })).toContain(`<p role="status">${M.BEM_INATIVADO('Monitor').replace(/"/g, '&quot;')}</p>`);
    await html({ tipo: 'CONTRATO', proposta: 'capac', meta: 'ofic', descricao: 'note', conta: '4.2', inicio: '2027-01-01', fim: '2027-06-30', zerados: 'nao', inativos: 'sim' });
    expect(caso.filtros.at(-1)).toEqual({
      tipo: 'CONTRATO',
      proposta: 'capac',
      meta: 'ofic',
      descricao: 'note',
      conta: '4.2',
      inicio: '2027-01-01',
      fim: '2027-06-30',
      exibirZerados: false,
      exibirInativos: true,
    });
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});
