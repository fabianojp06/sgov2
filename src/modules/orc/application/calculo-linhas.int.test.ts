import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { obterEscopoCentroCusto } from '@/modules/adm';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, falha } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { recalcular, recalcularExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';

// Auditoria que falha sob demanda (§10.2 item 1).
const falhaAuditoria = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/shared/audit', async (original) => {
  const real = await original<typeof import('@/shared/audit')>();
  return {
    ...real,
    auditar: async (...args: Parameters<typeof real.auditar>) => {
      if (falhaAuditoria.ligada) throw new Error('auditoria indisponível');
      return real.auditar(...args);
    },
  };
});

// Cálculo das linhas do orçamento (plano do P6, Task 2), com os falsos do C1 e do C2.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2030;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const ctx = (permissoes: string[] = ['orc.orcamento:alterar']): ContextoRequisicao => ({
  usuarioId: USUARIO,
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', // TP escolhido no seletor: não vai ao Histórico do orc
  permissoes: new Set(permissoes),
});

function deps(anoExercicio: number, extra: Partial<DepsOrc> = {}) {
  const custo = custoPessoalFalso([premissasExemplo(anoExercicio)]);
  const d: Partial<DepsOrc> = {
    cliente: app,
    estrutura: estruturaFinanceiraFalsa(),
    custoPessoal: custo,
    obterEscopo: async () => null,
    ...extra,
  };
  return { d, custo };
}

async function exercicio(): Promise<{ id: string; ano: number }> {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  await migrator.posicaoOrcada.create({
    data: { exercicioId: e.id, cc: '4.4', cargo: 'Analista', quantidade: 2, salarioMensal: '7500.00', mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' },
  });
  await migrator.pacoteBaseZero.create({
    data: {
      exercicioId: e.id, cc: '4.4', conta: '4.1.1.5.005', justificativa: 'Reposição anual de material', prioridade: 'IMPORTANTE',
      quantidade: 12, valorUnitario: '350.00', corrigirIpca: true, distribuicao: 'MENSAL', origem: 'IMPORTACAO',
    },
  });
  return { id: e.id, ano: a };
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
});

beforeEach(() => {
  falhaAuditoria.ligada = false;
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

const linhasDe = (exercicioId: string) => migrator.linhaOrcada.findMany({ where: { exercicioId }, orderBy: [{ origem: 'asc' }, { conta: 'asc' }] });

describe('recalcularExercicio', () => {
  it('posição pelo C2 (uma linha por componente) e pacote pela R4; versão das premissas gravada', async () => {
    const e = await exercicio();
    const { d, custo } = deps(e.ano);
    const r = await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(d)));
    expect(r.ok).toBe(true);
    expect(custo.chamadas).toHaveLength(1);
    expect(custo.chamadas[0]!.posicao).toEqual({ quantidade: 2, salarioMensal: Dinheiro.de('7500.00'), mesInicio: 1, mesSaida: 12 });
    const linhas = await linhasDe(e.id);
    expect(linhas.map((l) => [l.origem, l.conta, l.componente])).toEqual([
      ['BASE_ZERO', '4.1.1.5.005', null],
      ['PESSOAL', '4.1.1.1.001', 'salario'],
    ]);
    // Pacote 12 × 350,00 com o IPCA das premissas (4,5%): 4.389,00, 365,75 por mês.
    expect(linhas[0]!.total.toString()).toBe('4389');
    expect(linhas[0]!.meses.map(String)).toEqual(Array(12).fill('365.75'));
    expect(linhas[1]!.total.toString()).toBe('180000');
    const ex = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } });
    expect(ex.versaoPremissas).toBe(premissasExemplo(e.ano).versao);
  });

  it('recalcular de novo não duplica linhas; a soma das linhas fecha com as séries (§10.2 item 6)', async () => {
    const e = await exercicio();
    const { d } = deps(e.ano);
    await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(d)));
    await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(d)));
    const linhas = await linhasDe(e.id);
    expect(linhas).toHaveLength(2);
    for (const l of linhas) expect(Dinheiro.somarTodos(l.meses.map((m) => Dinheiro.de(m.toString()))).paraString()).toBe(Dinheiro.de(l.total.toString()).paraString());
  });

  it('erro do C2 numa posição: devolve o erro com o CC e o cargo, e nada é gravado', async () => {
    const e = await exercicio();
    const { d } = deps(e.ano);
    const custoComErro = { ...d.custoPessoal!, calcularCustoPosicao: () => falha([{ campo: 'salarioMensal', mensagem: 'Salário inválido.' }]) };
    const r = await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps({ ...d, custoPessoal: custoComErro })));
    expect(r).toEqual({ ok: false, erros: [{ campo: expect.stringContaining('salarioMensal'), mensagem: 'CC 4.4, cargo Analista: Salário inválido.' }] });
    expect(await linhasDe(e.id)).toEqual([]);
  });

  it('premissas inexistentes: orc.premissas_inexistentes', async () => {
    const e = await exercicio();
    const { d } = deps(e.ano, { custoPessoal: custoPessoalFalso([]) });
    await expect(app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(d)))).rejects.toEqual(
      expect.objectContaining({ codigo: 'orc.premissas_inexistentes' }),
    );
  });
});

describe('recalcular (caso de uso)', () => {
  it('com permissão: mensagem, Histórico com a versão antes e depois e sem TP, versão do exercício incrementada', async () => {
    const e = await exercicio();
    const { d } = deps(e.ano);
    const r = await recalcular(ctx(), e.id, d);
    expect(r).toEqual({ ok: true, valor: expect.objectContaining({ mensagem: MENSAGENS_ORC.RECALCULADO, linhas: 2 }) });
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.orcamento', registroId: e.id } });
    expect(h.tipoOperacao).toBe('ALTERACAO');
    expect(h.unidadeId).toBeNull();
    expect(h.antes).toMatchObject({ versaoPremissas: null });
    expect(h.depois).toMatchObject({ versaoPremissas: premissasExemplo(e.ano).versao });
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao).toBe(1);
  });

  it('Review Focus 4: premissas trocadas → mesmas posições e pacotes, linhas novas', async () => {
    const e = await exercicio();
    await recalcular(ctx(), e.id, deps(e.ano).d);
    const antes = { p: await migrator.posicaoOrcada.findMany({ where: { exercicioId: e.id } }), k: await migrator.pacoteBaseZero.findMany({ where: { exercicioId: e.id } }) };
    const novas = { ...premissasExemplo(e.ano), versao: 7, ipca: premissasExemplo(e.ano).reajuste };
    await recalcular(ctx(), e.id, deps(e.ano, { custoPessoal: custoPessoalFalso([novas]) }).d);
    expect(await migrator.posicaoOrcada.findMany({ where: { exercicioId: e.id } })).toEqual(antes.p);
    expect(await migrator.pacoteBaseZero.findMany({ where: { exercicioId: e.id } })).toEqual(antes.k);
    const pacote = (await linhasDe(e.id)).find((l) => l.origem === 'BASE_ZERO')!;
    expect(pacote.total.toString()).toBe('4410'); // 4.200,00 × 1,05
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versaoPremissas).toBe(7);
  });

  it('sem orc.orcamento:alterar: ErroPermissao (a definirAcao audita), nada muda', async () => {
    const e = await exercicio();
    await expect(recalcular(ctx(['orc.orcamento:consultar']), e.id, deps(e.ano).d)).rejects.toBeInstanceOf(ErroPermissao);
    expect(await linhasDe(e.id)).toEqual([]);
  });

  it('com escopo e com a ação: ErroPermissao (R15), com o CC de escopo lido do adm', async () => {
    const e = await exercicio();
    const gestor = await migrator.usuario.create({
      data: { nome: 'Gestor', email: 'g@exemplo.org', login: 'gestor', loginNormalizado: 'gestor', senhaHash: 'x', ccEscopo: '4.3' },
    });
    const c = { ...ctx(), usuarioId: gestor.id };
    await expect(recalcular(c, e.id, deps(e.ano, { obterEscopo: obterEscopoCentroCusto }).d)).rejects.toBeInstanceOf(ErroPermissao);
    expect(await linhasDe(e.id)).toEqual([]);
    // Usuário inexistente nunca vira "sem escopo" (R16).
    await expect(app.$transaction((tx) => obterEscopoCentroCusto(tx, '0b1e6f1a-1111-4c2b-9e0a-3d6f1f2a4b5c'))).rejects.toEqual(
      expect.objectContaining({ codigo: 'adm.usuario_inexistente' }),
    );
  });

  it('exercício Em Aprovação: mensagem da situação, nada muda', async () => {
    const e = await exercicio();
    await app.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    });
    await app.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = ${e.id}::uuid`;
    });
    expect(await recalcular(ctx(), e.id, deps(e.ano).d)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }],
    });
  });

  it('exercício inexistente ou id fora do formato: orc.exercicio_inexistente', async () => {
    await expect(recalcular(ctx(), '0b1e6f1a-0000-4c2b-9e0a-3d6f1f2a4b5c', deps(2030).d)).rejects.toEqual(
      expect.objectContaining({ codigo: 'orc.exercicio_inexistente' }),
    );
    await expect(recalcular(ctx(), 'x', deps(2030).d)).rejects.toEqual(expect.objectContaining({ codigo: 'orc.exercicio_inexistente' }));
  });

  it('auditoria falhando: nada muda (§10.2 item 1)', async () => {
    const e = await exercicio();
    falhaAuditoria.ligada = true;
    await expect(recalcular(ctx(), e.id, deps(e.ano).d)).rejects.toThrow('auditoria indisponível');
    expect(await linhasDe(e.id)).toEqual([]);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao).toBe(0);
  });
});
