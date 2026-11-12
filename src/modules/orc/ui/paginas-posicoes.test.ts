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
type OpcaoCargoTeste = { id: string; codigo: string; nome: string; salarioFonteAtiva: string | null; faixa: { minimo: string; maximo: string } | null };
const caso = vi.hoisted(() => ({
  situacao: 'RASCUNHO' as 'RASCUNHO' | 'EM_APROVACAO',
  origem: 'IMPORTACAO',
  cc: '4.3.0',
  cargoId: null as string | null,
  cargoInativo: false,
  cargo: 'Analista de orçamento',
  cargos: { cargos: [] as OpcaoCargoTeste[], comSalario: false, aviso: null as string | null },
  chamadasCargos: 0,
  semCcs: false,
  escopoTotal: true,
}));
const C001 = '00000000-0000-4000-8000-000000000001';
const C004 = '00000000-0000-4000-8000-000000000004';
const opcaoC001 = (comSalario: boolean): OpcaoCargoTeste => ({
  id: C001, codigo: 'C001', nome: 'Analista de orçamento',
  salarioFonteAtiva: comSalario ? '7500.00' : null, faixa: comSalario ? { minimo: '7500.00', maximo: '9800.00' } : null,
});
// A máscara é do servidor (listarPosicoes): o falso imita, com salário e anual nulos sem incluir/alterar.
vi.mock('@/modules/orc', async (original) => {
  const editavel = () => caso.situacao === 'RASCUNHO';
  const ve = (ctx: ContextoRequisicao) => ctx.permissoes.has('orc.posicoes:incluir') || ctx.permissoes.has('orc.posicoes:alterar');
  const p = (ctx: ContextoRequisicao) => ({
    id: 'p1', cc: caso.cc, cargo: caso.cargo, cargoId: caso.cargoId, cargoInativo: caso.cargoInativo, quantidade: 1, salarioMensal: ve(ctx) ? Dinheiro.de('7321.45') : null,
    mesInicio: 3, mesSaida: 12, observacao: null, origem: caso.origem, versao: 2, valorAnual: ve(ctx) ? Dinheiro.de('98765.43') : null,
  });
  return {
    ...(await original<typeof import('@/modules/orc')>()),
    listarExercicios: async () => [{ id: 'e1', ano: 2027, situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', versao: 0 }],
    listarPosicoes: async (ctx: ContextoRequisicao) => ({ posicoes: [p(ctx)], editavel: editavel(), veSalario: ve(ctx) }),
    opcoesPosicao: async () => ({
      ccs: caso.semCcs ? [] : [{ classificacao: '4.3.0', descricao: 'Gabinete' }], quantidadeMaxima: 9999,
      situacao: caso.situacao, rotuloSituacao: caso.situacao === 'RASCUNHO' ? 'Rascunho' : 'Em Aprovação', editavel: editavel(), escopoTotal: caso.escopoTotal,
    }),
    cargosParaPosicao: async () => {
      caso.chamadasCargos++;
      return caso.cargos;
    },
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
  caso.cargoId = null;
  caso.cargoInativo = false;
  caso.cargo = 'Analista de orçamento';
  caso.cargos = { cargos: [opcaoC001(false)], comSalario: false, aviso: 'O salário da Fonte Ativa não aparece para o seu perfil. Informe o salário mensal.' };
  caso.chamadasCargos = 0;
  caso.semCcs = false;
  caso.escopoTotal = true;
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

describe('cargo do cadastro de C&S na posição (P15)', () => {
  it('quem só consulta não recebe a lista de cargos (cargosParaPosicao nem é chamado)', async () => {
    contexto = ctx(['orc.posicoes:consultar']);
    await html();
    expect(caso.chamadasCargos).toBe(0);
  });

  it('exercício fechado: também não chama cargosParaPosicao', async () => {
    contexto = ctx(TUDO);
    caso.situacao = 'EM_APROVACAO';
    await html();
    expect(caso.chamadasCargos).toBe(0);
  });

  it('Gestor (sem cad.salarios): seletor com os cargos e o texto livre, sem Fonte Ativa, com o aviso do perfil', async () => {
    contexto = ctx(TUDO);
    const h = await html();
    expect(caso.chamadasCargos).toBe(1);
    expect(h).toContain('name="cargoId"');
    expect(h).toContain('C001 – Analista de orçamento');
    expect(h).toContain('Outro cargo (texto livre)');
    expect(h).toContain('O salário da Fonte Ativa não aparece para o seu perfil. Informe o salário mensal.');
    expect(h).not.toContain('Fonte Ativa: R$');
    expect(h).not.toContain('7.500,00');
  });

  it('inclusão: abre sem cargo escolhido ("Escolha o cargo"), sem Fonte Ativa e com o salário vazio', async () => {
    contexto = ctx(TUDO);
    caso.cargos = { cargos: [opcaoC001(true)], comSalario: true, aviso: null };
    const h = await html();
    expect(h).toMatch(/<option value="[^"]*" disabled="" selected="">Escolha o cargo<\/option>/);
    expect(h).not.toContain('Fonte Ativa: R$');
    expect(h).not.toContain('7.500,00');
    expect(h).not.toContain('name="cargo"');
  });

  it('GFIN (com cad.salarios) alterando posição do C001: a Fonte Ativa e a faixa do cargo', async () => {
    contexto = ctx(TUDO);
    caso.cargos = { cargos: [opcaoC001(true)], comSalario: true, aviso: null };
    caso.cargoId = C001;
    const h = await html({ editar: 'p1' });
    expect(h).toContain('Fonte Ativa: R$ 7.500,00 · Faixa de mercado: R$ 7.500,00 a R$ 9.800,00');
    expect(h).toMatch(new RegExp(`<option value="${C001}" selected="">C001 – Analista de orçamento</option>`));
  });

  it('só alterar, sem ?editar=: nenhum formulário, e cargosParaPosicao nem é chamado', async () => {
    contexto = ctx(['orc.posicoes:consultar', 'orc.posicoes:alterar']);
    const h = await html();
    expect(h).not.toContain('Nova posição');
    expect(caso.chamadasCargos).toBe(0);
  });

  it('nenhum CC disponível para inclusão: nenhum formulário, e cargosParaPosicao nem é chamado', async () => {
    contexto = ctx(TUDO);
    caso.semCcs = true;
    const h = await html();
    expect(h).not.toContain('Nova posição');
    expect(caso.chamadasCargos).toBe(0);
  });

  it('alteração de posição em texto livre: a opção "Manter o cargo em texto" marcada, com o texto gravado', async () => {
    contexto = ctx(TUDO);
    caso.cargo = 'Assistente temporário';
    const h = await html({ editar: 'p1' });
    expect(h).toMatch(/<option value="" selected="">Manter o cargo em texto: Assistente temporário<\/option>/);
    expect(h).toContain('value="Assistente temporário"');
  });

  it('posição em cargo inativo: "(inativo)" na lista e no seletor da alteração', async () => {
    contexto = ctx(TUDO);
    caso.cargoId = C004;
    caso.cargoInativo = true;
    caso.cargo = 'Cargo extinto';
    const h = await html({ editar: 'p1' });
    expect(h).toContain('Cargo extinto (inativo)</th>');
    expect(h).toMatch(new RegExp(`<option value="${C004}" selected="">Cargo extinto \\(inativo\\)</option>`));
  });

  it('sem nenhum cargo utilizável: só o texto livre, com o aviso', async () => {
    contexto = ctx(TUDO);
    caso.cargos = { cargos: [], comSalario: false, aviso: null };
    const h = await html();
    expect(h).not.toContain('<select id="nova-posicao-cargo-id"');
    expect(h).toContain('<input type="hidden" name="cargoId" value=""/>');
    expect(h).toContain('Não há cargo do cadastro disponível; informe o cargo em texto.');
    expect(h).toContain('name="cargo"');
  });
});

describe('link da correspondência do cargo em texto (P16)', () => {
  const LINK = 'href="/orc/posicoes/correspondencia?ano=2027"';
  it('aparece para quem altera com escopo TOTAL, num exercício editável com posição sem cargo', async () => {
    contexto = ctx(TUDO);
    const h = await html();
    expect(h).toContain(LINK);
    expect(h).toContain('Ligar cargos em texto ao cadastro');
  });

  it('não aparece com subárvore, sem alterar, com o exercício fechado ou sem posição em texto', async () => {
    contexto = ctx(TUDO);
    caso.escopoTotal = false;
    expect(await html()).not.toContain(LINK);
    caso.escopoTotal = true;
    contexto = ctx(['orc.posicoes:consultar', 'orc.posicoes:incluir']);
    expect(await html()).not.toContain(LINK);
    contexto = ctx(TUDO);
    caso.situacao = 'EM_APROVACAO';
    expect(await html()).not.toContain(LINK);
    caso.situacao = 'RASCUNHO';
    caso.cargoId = C001;
    expect(await html()).not.toContain(LINK);
  });
});
