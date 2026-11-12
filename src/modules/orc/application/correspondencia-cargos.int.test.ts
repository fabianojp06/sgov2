import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calcularCustoPosicao, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { ligarCargoPosicoes, listarCorrespondencias, normalizarNome } from './correspondencia-cargos';
import type { DepsOrc } from './deps';

// Tela de correspondência do cargo em texto com o cadastro de C&S (US-056, #410; plano do P16, Task 1).
// Cargos do falso do cad: C001 "Analista de orçamento" (ativo, Fonte Ativa), C002, C003 (sem Fonte Ativa)
// e C004 (inativo). CCs analíticos do falso do C1: 4.3.0, 4.3.2.10, 4.3.2.11 e 4.4.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2060;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const GFIN = ['orc.posicoes:consultar', 'orc.posicoes:incluir', 'orc.posicoes:alterar', 'orc.posicoes:excluir'];
const ctx = (permissoes: string[] = GFIN): ContextoRequisicao => ({ usuarioId: USUARIO, usuarioRotulo: 'gfin', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
const [C001, C002, C003, C004] = cargosExemplo().map((c) => c.id) as [string, string, string, string];
const TEXTO = 'Analista de orçamento';
const OUTRO_TEXTO = 'analista de  ORCAMENTO';

async function exercicio(o: { versaoPremissas?: number } = {}) {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  await migrator.$executeRaw`UPDATE orc_exercicio SET versao_premissas = 1 WHERE id = ${e.id}::uuid`;
  const deps = (escopo: string | null = null): Partial<DepsOrc> => {
    const custo = { ...custoPessoalFalso([{ ...premissasExemplo(a), versao: o.versaoPremissas ?? 1 }], cargosExemplo()), calcularCustoPosicao };
    return { cliente: app, estrutura: estruturaFinanceiraFalsa(), custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio, obterEscopo: async () => escopo };
  };
  const posicao = (cargo: string, extra: { cc?: string; salario?: string; cargoId?: string } = {}) =>
    migrator.posicaoOrcada.create({
      data: { exercicioId: e.id, cc: extra.cc ?? '4.3.0', cargo, cargoId: extra.cargoId ?? null, quantidade: 1, salarioMensal: extra.salario ?? '7000.00', mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' },
    });
  const versao = async () => (await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao;
  return { ...e, deps, posicao, versao };
}
type Ex = Awaited<ReturnType<typeof exercicio>>;

// Três posições em texto (duas no TEXTO, em CCs diferentes; uma no OUTRO_TEXTO) e uma já ligada a C002.
async function cenario(o: { versaoPremissas?: number } = {}) {
  const e = await exercicio(o);
  const a = await e.posicao(TEXTO, { salario: '7000.00' });
  const b = await e.posicao(TEXTO, { cc: '4.4', salario: '8100.50' });
  const c = await e.posicao(OUTRO_TEXTO, { salario: '6000.00' });
  await e.posicao('Técnico de manutenção', { cargoId: C002 });
  return { e, a, b, c };
}
const ligar = async (e: Ex, extra: Record<string, unknown> = {}, permissoes = GFIN, escopo: string | null = null) =>
  ligarCargoPosicoes(ctx(permissoes), { exercicioId: e.id, texto: TEXTO, cargoId: C001, versao: String(await e.versao()), ...extra }, e.deps(escopo));
const historicos = (registroId: string) => migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.posicoes', registroId, tipoOperacao: 'ALTERACAO' } });
const componentes = async (posicaoId: string) => (await migrator.linhaOrcada.findMany({ where: { posicaoId } })).map((l) => l.componente).sort();

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('normalizarNome', () => {
  it('ignora acentos, maiúsculas e espaços repetidos', () => {
    expect(normalizarNome('  Analista de  ORÇAMENTO ')).toBe('analista de orcamento');
    expect(normalizarNome(OUTRO_TEXTO)).toBe(normalizarNome(TEXTO));
  });
});

describe('listarCorrespondencias', () => {
  // Ordem alfabética do pt-BR (a minúscula vem antes).
  it('um item por texto exato das posições sem cargo, com a sugestão pelo nome igual; a posição ligada não aparece', async () => {
    const { e } = await cenario();
    const l = await listarCorrespondencias(ctx(), e.id, e.deps());
    expect(l).toMatchObject({ versao: await e.versao(), editavel: true });
    expect(l.itens).toEqual([
      { texto: OUTRO_TEXTO, posicoes: 1, ccs: 1, salarioMinimo: '6000.00', salarioMaximo: '6000.00', sugestaoId: C001 },
      { texto: TEXTO, posicoes: 2, ccs: 2, salarioMinimo: '7000.00', salarioMaximo: '8100.50', sugestaoId: C001 },
    ]);
    // Os cargos da escolha são os da posição: ativos e com Fonte Ativa; sem cad.salarios, sem valores.
    expect(l.cargos.cargos.map((c) => c.id)).toEqual([C001, C002]);
    expect(l.cargos.comSalario).toBe(false);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'cad.salarios', usuarioId: USUARIO } })).toBe(0);
  });

  it('texto sem cargo de nome igual fica sem sugestão; exercício fora da edição não lista nada', async () => {
    const e = await exercicio();
    await e.posicao('Analista Orç.');
    expect((await listarCorrespondencias(ctx(), e.id, e.deps())).itens.map((i) => i.sugestaoId)).toEqual([null]);
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${USUARIO}::uuid WHERE id = ${e.id}::uuid`;
    expect(await listarCorrespondencias(ctx(), e.id, e.deps())).toMatchObject({ itens: [], editavel: false, cargos: { cargos: [] } });
  });

  it('o Gestor de Diretoria (escopo de subárvore) e quem só consulta são recusados', async () => {
    const e = await exercicio();
    await expect(listarCorrespondencias(ctx(), e.id, e.deps('4.3'))).rejects.toBeInstanceOf(ErroPermissao);
    await expect(listarCorrespondencias(ctx(['orc.posicoes:consultar']), e.id, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('ligarCargoPosicoes', () => {
  it('liga as posições do texto ao cargo: nome do cadastro, salário igual, versões, linhas com os benefícios do cargo e uma ALTERACAO por posição', async () => {
    const { e, a, b, c } = await cenario();
    const versaoAntes = await e.versao();
    const antesA = await componentes(a.id);
    expect(await ligar(e)).toEqual({ ok: true, valor: { ano: e.ano, posicoes: 2 } });
    for (const p of [a, b]) {
      const depois = await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: p.id } });
      expect(depois).toMatchObject({ cargoId: C001, cargo: 'Analista de orçamento', versao: p.versao + 1, origem: 'IMPORTACAO' });
      expect(depois.salarioMensal.toString()).toBe(p.salarioMensal.toString());
      const [h, ...resto] = await historicos(p.id);
      expect(resto).toEqual([]);
      expect(h!.descricao).toBe(`Cargo da posição ligado ao cadastro (C001) no CC ${p.cc}, exercício ${e.ano}`);
      expect(h!.descricao).not.toMatch(/\d{3,}[.,]\d{2}/);
      expect(h!.antes).toMatchObject({ cargoId: null, cargo: TEXTO });
      expect(h!.depois).toMatchObject({ cargoId: C001, cargo: 'Analista de orçamento', salarioMensal: depois.salarioMensal.toFixed(2) });
    }
    expect(await e.versao()).toBe(versaoAntes + 1);
    // As linhas da posição foram refeitas pelo motor com o cargo.
    expect((await componentes(a.id)).some((x) => x?.startsWith('beneficio.'))).toBe(true);
    expect(antesA).toEqual([]);
    // O outro texto (outra grafia) continua sem cargo.
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ cargoId: null, cargo: OUTRO_TEXTO });
    // Ligado, o texto sai da lista.
    expect((await listarCorrespondencias(ctx(), e.id, e.deps())).itens.map((i) => i.texto)).toEqual([OUTRO_TEXTO]);
  });

  it('com as premissas mudadas desde o último cálculo, recalcula o exercício inteiro (versaoPremissas no Histórico)', async () => {
    const { e, a } = await cenario({ versaoPremissas: 2 });
    expect(await ligar(e)).toMatchObject({ ok: true });
    const [h] = await historicos(a.id);
    expect(h!.descricao).toContain('com o orçamento recalculado');
    expect(h!.antes).toMatchObject({ versaoPremissas: 1 });
    expect(h!.depois).toMatchObject({ versaoPremissas: 2 });
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versaoPremissas).toBe(2);
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ cargoId: C001 });
    expect((await componentes(a.id)).some((x) => x?.startsWith('beneficio.'))).toBe(true);
  });

  it('outra pessoa mexeu no exercício depois da leitura da tela (duas abas) → alterado por outro, nada gravado', async () => {
    const { e, a } = await cenario();
    const lida = await e.versao();
    // Outra escrita no exercício (como a de uma posição pela tela) sobe a versão.
    await migrator.orcamentoExercicio.update({ where: { id: e.id }, data: { versao: { increment: 1 } } });
    const r = await ligar(e, { versao: String(lida) });
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }] });
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ cargoId: null });
    expect(await historicos(a.id)).toEqual([]);
  });

  it('cargo inativo, sem Fonte Ativa ou inexistente é recusado com a mensagem da posição', async () => {
    const { e, a } = await cenario();
    expect(await ligar(e, { cargoId: C004 })).toEqual({ ok: false, erros: [{ campo: 'cargoId', mensagem: 'Este cargo está inativo. Escolha outro.' }] });
    expect(await ligar(e, { cargoId: C003 })).toMatchObject({ ok: false, erros: [{ campo: 'cargoId', mensagem: expect.stringContaining('sem salário na Fonte Ativa') }] });
    expect(await ligar(e, { cargoId: '00000000-0000-4000-8000-0000000000ff' })).toEqual({ ok: false, erros: [{ campo: 'cargoId', mensagem: 'Cargo não encontrado no cadastro.' }] });
    expect(await historicos(a.id)).toEqual([]);
  });

  it('texto sem posição sem cargo → recarregar; exercício fora da edição → recusado', async () => {
    const { e } = await cenario();
    expect(await ligar(e, { texto: 'Inexistente' })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Nenhuma posição com esse cargo em texto. Recarregue a tela.' }] });
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${USUARIO}::uuid WHERE id = ${e.id}::uuid`;
    expect(await ligar(e)).toMatchObject({ ok: false, erros: [{ mensagem: expect.stringContaining('não pode ser alterado') }] });
  });

  it('erro do motor numa das posições → o erro com o CC e nenhuma posição ligada', async () => {
    const { e, a, b } = await cenario();
    const deps = e.deps();
    const custo = deps.custoPessoal!;
    const quebrado: Partial<DepsOrc> = {
      ...deps,
      custoPessoal: {
        ...custo,
        calcularCustoPosicao: (p, premissas) => (p.salarioMensal.paraString() === '8100.50' ? { ok: false, erros: [{ campo: '_', mensagem: 'premissa incompleta.' }] } : custo.calcularCustoPosicao(p, premissas)),
      },
    };
    const r = await ligarCargoPosicoes(ctx(), { exercicioId: e.id, texto: TEXTO, cargoId: C001, versao: String(await e.versao()) }, quebrado);
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'CC 4.4: premissa incompleta.' }] });
    for (const p of [a, b]) expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ cargoId: null });
  });

  it('o Gestor de Diretoria chamando direto é recusado, sem Histórico', async () => {
    const { e, a } = await cenario();
    await expect(ligar(e, {}, GFIN, '4.3')).rejects.toBeInstanceOf(ErroPermissao);
    await expect(ligar(e, {}, ['orc.posicoes:consultar'])).rejects.toBeInstanceOf(ErroPermissao);
    expect(await historicos(a.id)).toEqual([]);
  });
});
