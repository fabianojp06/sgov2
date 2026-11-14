import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { Dinheiro } from '@/shared/kernel';
import type { BlocoEmpregados, EmpregadoTela } from '../application/empregados';
import type { FiltrosPessoal } from '../application/pessoal-comum';
import type { BlocoQtdes } from '../application/qtde-empregados';
import { MENSAGENS_ORC as M } from '../domain/mensagens';

type SituacaoLoteTeste = 'EM_ELABORACAO' | 'EM_APROVACAO' | 'HOMOLOGADO';

// Páginas do pessoal da proposta (US-070; plano do P20, Task 2, Step 1).
vi.mock('next/server', () => ({ connection: async () => undefined }));
const P_META = '00000000-0000-4000-8000-0000000000b1';
const P_APROVACAO = '00000000-0000-4000-8000-0000000000b2';
const P_SEM_META = '00000000-0000-4000-8000-0000000000b3';
const M1 = '00000000-0000-4000-8000-0000000000c1';
const E1 = '00000000-0000-4000-8000-0000000000d1';
const E2 = '00000000-0000-4000-8000-0000000000d2';
const Q1 = '00000000-0000-4000-8000-0000000000e1';
const caso = vi.hoisted(() => ({ filtros: [] as unknown[], cargos: 0, aprovadores: { titular: 'Gestor (gfin)', substituto: 'Diretoria' } as { titular: string; substituto: string } | { motivo: string }, lote: 'EM_ELABORACAO' as string }));

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
const totais = (e: number, s: number, j: number) => ({ EMPREGADO: e, ESTAGIARIO: s, JOVEM_APRENDIZ: j });
const empregado = (extra: Partial<EmpregadoTela>): EmpregadoTela => ({
  id: E1,
  metaId: M1,
  ordem: 1,
  categoria: 'EMPREGADO',
  nome: 'Ana',
  cargoId: 'c1',
  cargo: 'C001 – Analista de orçamento',
  vinculoFuncional: 'Setor de Orçamento',
  inicio: '2027-03',
  fim: '2027-12',
  dependentes: 1,
  versao: 0,
  custoMensal: Dinheiro.de('7500'),
  custoPeriodo: Dinheiro.de('75000'),
  avisos: [],
  ...extra,
});
const blocoEmp = (extra: Partial<BlocoEmpregados>, veCusto: boolean): BlocoEmpregados => ({
  ...cabecalho,
  grupos: [
    {
      metaId: M1,
      metaNumero: 'M1',
      metaNome: 'Oficinas',
      empregados: [empregado({}), empregado({ id: E2, ordem: 2, nome: null, categoria: 'ESTAGIARIO', vinculoFuncional: null, avisos: ['O exercício 2028 não tem parâmetros.'] })],
      totais: totais(1, 1, 0),
    },
  ],
  totais: totais(1, 1, 0),
  veCusto,
  lote: caso.lote as SituacaoLoteTeste,
  finalizavel: caso.lote === 'EM_ELABORACAO',
  ...extra,
});

vi.mock('@/modules/orc', async (original) => {
  const { exigir } = await import('@/shared/authz');
  const veCusto = (ctx: ContextoRequisicao) => ctx.permissoes.has('orc.empregados:incluir');
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarEmpregados: async (ctx: ContextoRequisicao, filtros: FiltrosPessoal) => {
      exigir(ctx, 'orc.empregados', 'consultar');
      caso.filtros.push(filtros);
      const custo = veCusto(ctx);
      return [
        blocoEmp({}, custo),
        blocoEmp({ propostaId: P_APROVACAO, numero: 'TP-2027/002', situacao: 'EM_APROVACAO', editavel: false, grupos: [] }, custo),
        blocoEmp({ propostaId: P_SEM_META, numero: 'TP-2027/003', metas: [], grupos: [] }, custo),
      ];
    },
    aprovadoresDoLote: async () => caso.aprovadores,
    cargosParaEmpregado: async () => {
      caso.cargos++;
      return [{ id: 'c1', codigo: 'C001', nome: 'Analista de orçamento' }];
    },
    listarQtdes: async (ctx: ContextoRequisicao): Promise<BlocoQtdes[]> => {
      exigir(ctx, 'orc.qtde_empregados', 'consultar');
      return [
        {
          ...cabecalho,
          grupos: [
            {
              metaId: M1,
              metaNumero: 'M1',
              metaNome: 'Oficinas',
              qtdes: [{ id: Q1, metaId: M1, documento: 'AP-01', inicio: '2027-01', fim: '2027-06', quantidades: totais(2, 0, 1), versao: 0 }],
              totais: totais(2, 0, 1),
            },
          ],
          totais: totais(2, 0, 1),
        },
      ];
    },
  };
});

const { default: Empregados } = await import('../../../app/(sistema)/orc/empregados/page');
const { default: QtdeEmpregados } = await import('../../../app/(sistema)/orc/qtde-empregados/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const LANCA = (f: string) => ['consultar', 'incluir', 'alterar', 'excluir'].map((a) => `${f}:${a}`);
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  caso.filtros = [];
  caso.cargos = 0;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Empregados({ searchParams: Promise.resolve(busca) }));
const trecho = (h: string, id: string) => {
  const inicio = h.indexOf(`<section aria-labelledby="empregados-${id}"`);
  const fim = h.indexOf('<section aria-labelledby="empregados-', inicio + 1);
  return h.slice(inicio, fim === -1 ? undefined : fim);
};

describe('página dos empregados da proposta', () => {
  it('quem lança: grupo por meta, "A CONTRATAR", custo com aviso, totais por categoria, ações e "Novo empregado"', async () => {
    contexto = ctx(LANCA('orc.empregados'));
    const b = trecho(await html(), P_META);
    expect(b).toContain('<caption id="empregados-' + P_META + '-' + M1 + '-caption">Meta M1 – Oficinas, custos em R$</caption>');
    expect(b).toContain(
      '<th scope="col">Ordem</th><th scope="col">Empregado</th><th scope="col">Categoria</th><th scope="col">Cargo</th><th scope="col">Vínculo Funcional</th><th scope="col">Competência</th><th scope="col">Custo total mensal</th><th scope="col">Ações</th>',
    );
    expect(b).toContain('<th scope="row">1</th><td>Ana</td><td>Empregado</td><td>C001 – Analista de orçamento</td><td>Setor de Orçamento</td><td>03/2027 a 12/2027</td><td>7.500,00</td>');
    expect(b).toContain('<th scope="row">2</th><td>A CONTRATAR</td><td>Estagiário</td><td>C001 – Analista de orçamento</td><td>—</td>');
    expect(b).toContain('<small role="note"> O exercício 2028 não tem parâmetros.</small>');
    expect(b).toContain('<strong>Total da meta M1:</strong> Empregados 1 · Estagiários 1 · Jovens Aprendizes 0');
    expect(b).toContain(`<a href="/orc/empregados?editar=${E1}">Editar o empregado 1</a>`);
    expect(b).toContain('Excluir o empregado 2 (A CONTRATAR)');
    expect(b).toContain(`<a href="/orc/empregados?nova=${P_META}">Novo empregado na proposta TP-2027/001</a>`);
  });

  it('quem só consulta: sem a coluna de custo, sem ações; Em Aprovação sem "Novo"; Meta sem meta ativa: a nota', async () => {
    contexto = ctx(['orc.empregados:consultar']);
    const h = await html();
    const b = trecho(h, P_META);
    expect(b).not.toContain('Custo total mensal');
    expect(b).not.toContain('7.500,00');
    expect(b).not.toContain('Editar');
    contexto = ctx(LANCA('orc.empregados'));
    const h2 = await html();
    expect(trecho(h2, P_APROVACAO)).toContain('Nenhum empregado nesta versão.');
    expect(trecho(h2, P_APROVACAO)).not.toContain('Novo empregado');
    expect(trecho(h2, P_SEM_META)).toContain('Cadastre uma meta ativa na proposta antes de lançar empregados.');
  });

  it('?nova= abre o formulário com a meta, o cargo e as competências; a lista vem sem filtro; ?editar= com a ordem e a meta só leitura', async () => {
    contexto = ctx(LANCA('orc.empregados'));
    const h = await html({ nova: P_META, proposta: 'x' });
    expect(caso.filtros).toEqual([{}]);
    expect(caso.cargos).toBe(1);
    expect(h).toContain('Novo empregado na proposta TP-2027/001</h2>');
    expect(h).toMatch(/<select id="novo-empregado-meta" name="metaId"/);
    expect(h).toContain(`<option value="${M1}">M1 – Oficinas</option>`);
    expect(h).toContain('<option value="c1">C001 – Analista de orçamento</option>');
    expect(h).toContain('<input id="novo-empregado-inicio" type="month" min="2027-01" max="2027-12" aria-required="true" aria-describedby="erro-inicio" name="inicio" value="2027-01"/>');
    expect(h).toContain('<label for="novo-empregado-nome">Nome (vazio: A CONTRATAR)</label>');
    expect(h).not.toContain('salario');
    const e = await html({ editar: E1 });
    expect(e).toContain('Alterar o empregado 1 da proposta TP-2027/001</h2>');
    expect(e).toContain('<input id="alterar-empregado-meta" readOnly="" value="M1 – Oficinas"/>');
    expect(e).toContain('<input id="alterar-empregado-ordem" readOnly="" value="1"/>');
    expect(e).not.toContain('name="metaId"');
  });

  it('avisos e filtros; sem permissão: 404', async () => {
    contexto = ctx(LANCA('orc.empregados'));
    expect(await html({ aviso: 'incluido', o: '3', n: 'A CONTRATAR' })).toContain(`<p role="status">${M.EMPREGADO_INCLUIDO(3, 'A CONTRATAR')}</p>`);
    expect(await html({ aviso: 'incluido', o: 'x', n: 'Ana' })).not.toContain('incluído.');
    await html({ tipo: 'CONTRATO', proposta: 'capac', meta: 'ofic' });
    expect(caso.filtros.at(-1)).toEqual({ tipo: 'CONTRATO', proposta: 'capac', meta: 'ofic' });
    contexto = ctx(['orc.propostas:consultar']);
    expect(await digest(html())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes).toHaveLength(1);
  });
});

describe('finalizar os lançamentos (US-080, WA05)', () => {
  it('o GRH vê o botão com os aprovadores no modal; sem alçada, o aviso; sem executar, nada', async () => {
    contexto = ctx([...LANCA('orc.empregados'), 'orc.empregados:executar']);
    caso.lote = 'EM_ELABORACAO';
    const h = await html();
    expect(h).toContain('Finalizar os lançamentos de pessoal da proposta TP-2027/001');
    expect(h).toContain('Pessoal em elaboração');
    caso.aprovadores = { motivo: 'Operação indisponível: Não há aprovador ativo cadastrado para este fluxo.' };
    expect(await html()).toContain('Não há aprovador ativo cadastrado para este fluxo');
    caso.aprovadores = { titular: 'Gestor (gfin)', substituto: 'Diretoria' };
    contexto = ctx(LANCA('orc.empregados'));
    expect(await html()).not.toContain('Finalizar os lançamentos');
  });

  it('com o lote em aprovação: o selo e nenhuma ação; o aviso depois de finalizar', async () => {
    contexto = ctx([...LANCA('orc.empregados'), 'orc.empregados:executar']);
    caso.lote = 'EM_APROVACAO';
    const h = await html({ aviso: 'finalizado', n: 'TP-2027/001' });
    expect(h).toContain('Pessoal em aprovação (WA05)');
    expect(h).not.toContain('Finalizar os lançamentos');
    expect(h).toContain(M.LOTE_FINALIZADO('TP-2027/001'));
    caso.lote = 'EM_ELABORACAO';
  });
});

describe('página dos quantitativos', () => {
  const htmlQ = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await QtdeEmpregados({ searchParams: Promise.resolve(busca) }));

  it('as quantidades contadas só leitura, o total da meta, as ações e o formulário só com período e documento', async () => {
    contexto = ctx(LANCA('orc.qtde_empregados'));
    const h = await htmlQ();
    expect(h).toContain('<th scope="row">AP-01</th><td>01/2027</td><td>06/2027</td><td>2</td><td>0</td><td>1</td>');
    expect(h).toContain('<strong>Total da meta M1:</strong> Empregados 2 · Estagiários 0 · Jovens Aprendizes 1');
    expect(h).toContain(`<a href="/orc/qtde-empregados?editar=${Q1}">Editar o quantitativo AP-01</a>`);
    const f = await htmlQ({ nova: P_META });
    expect(f).toContain('name="documento"');
    expect(f).not.toMatch(/name="(empregados|estagiarios|jovensAprendizes)"/);
    expect(await htmlQ({ aviso: 'excluida', d: 'AP-01' })).toContain(`<p role="status">${M.QTDE_EXCLUIDA('AP-01')}</p>`);
  });

  it('só consulta: sem ações; sem permissão: 404', async () => {
    contexto = ctx(['orc.qtde_empregados:consultar']);
    expect(await htmlQ()).not.toContain('Editar');
    contexto = ctx(['orc.empregados:consultar']);
    expect(await digest(htmlQ())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
