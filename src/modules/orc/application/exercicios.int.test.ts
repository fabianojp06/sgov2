import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, falha, Percentual } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { DepsOrc } from './deps';
import { avancarExercicio, criarExercicio, listarExercicios } from './exercicios';

const falhaAuditoria = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/shared/audit', async (original) => {
  const real = await original<typeof import('@/shared/audit')>();
  return {
    ...real,
    auditar: async (...args: Parameters<typeof real.auditar>) => {
      if (falhaAuditoria.ligada && args[1].tipo !== 'SISTEMA') throw new Error('auditoria indisponível');
      return real.auditar(...args);
    },
  };
});

// Exercícios do orçamento (US-055; plano do P6, Task 3), com os falsos do C1 e do C2.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const GFIN = ['orc.exercicios:consultar', 'orc.exercicios:incluir', 'orc.exercicios:alterar', 'orc.orcamento:consultar'];
const ctx = (permissoes: string[] = GFIN): ContextoRequisicao => ({
  usuarioId: USUARIO,
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  permissoes: new Set(permissoes),
});

function deps(extra: Partial<DepsOrc> = {}) {
  const custo = custoPessoalFalso([]);
  return { d: { cliente: app, estrutura: estruturaFinanceiraFalsa(), custoPessoal: custo, obterEscopo: async () => null, ...extra } as Partial<DepsOrc>, custo };
}

async function exercicioComLancamentos(ano: number, extra: { ccPosicao?: string; contaPacote?: string } = {}) {
  const e = await migrator.orcamentoExercicio.create({ data: { ano, tetoManual: '1000.00' } });
  const posicao = (cc: string, cargo: string) =>
    migrator.posicaoOrcada.create({ data: { exercicioId: e.id, cc, cargo, quantidade: 2, salarioMensal: '7500.00', mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' } });
  const pacote = (conta: string) =>
    migrator.pacoteBaseZero.create({
      data: {
        exercicioId: e.id, cc: '4.4', conta, justificativa: 'Reposição anual de material', prioridade: 'IMPORTANTE',
        quantidade: 12, valorUnitario: '350.00', corrigirIpca: true, distribuicao: 'MENSAL', origem: 'IMPORTACAO',
      },
    });
  await posicao('4.4', 'Analista');
  await posicao(extra.ccPosicao ?? '4.3.0', 'Assessor');
  await pacote('4.1.1.5.005');
  await pacote('4.1.1.5.005');
  await pacote(extra.contaPacote ?? '4.1.1.5.005');
  await migrator.receitaRateio.create({ data: { exercicioId: e.id, tp: '001/2026', descricao: '', situacao: 'CONFIRMADO', meses: Array(12).fill('1.00'), total: '12.00' } });
  return e;
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

describe('criarExercicio em branco', () => {
  it('cria em Rascunho, garante as premissas do ano e audita sem TP', async () => {
    const { d, custo } = deps();
    const r = await criarExercicio(ctx(), { ano: '2040', forma: 'EM_BRANCO' }, d);
    expect(r).toEqual({ ok: true, valor: { id: expect.any(String), copiadas: { posicoes: 0, pacotes: 0 }, puladas: { posicoes: 0, pacotes: 0 } } });
    const e = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2040 } });
    expect(e).toMatchObject({ situacao: 'RASCUNHO', versaoPremissas: 1 });
    expect(await custo.obterPremissasExercicio(app, 2040)).not.toBeNull();
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.exercicios', registroId: e.id } });
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', unidadeId: null, descricao: 'Exercício 2040 criado em branco' });
  });

  it('ano repetido, ano fora da faixa e forma ausente', async () => {
    expect(await criarExercicio(ctx(), { ano: 2040, forma: 'EM_BRANCO' }, deps().d)).toEqual({
      ok: false,
      erros: [{ campo: 'ano', mensagem: 'Já existe um exercício para o ano 2040.' }],
    });
    for (const ano of [1999, 2100, 'x']) {
      expect(await criarExercicio(ctx(), { ano, forma: 'EM_BRANCO' }, deps().d)).toEqual({
        ok: false,
        erros: [{ campo: 'ano', mensagem: 'Informe um ano entre 2000 e 2099.' }],
      });
    }
    expect(await criarExercicio(ctx(), { ano: 2041 }, deps().d)).toEqual({ ok: false, erros: [{ campo: 'forma', mensagem: 'Escolha a forma de início do exercício.' }] });
  });

  it('duas criações simultâneas do mesmo ano: uma cria, a outra recebe a mensagem de ano repetido', async () => {
    const rs = await Promise.all([criarExercicio(ctx(), { ano: 2042, forma: 'EM_BRANCO' }, deps().d), criarExercicio(ctx(), { ano: 2042, forma: 'EM_BRANCO' }, deps().d)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, erros: [{ campo: 'ano', mensagem: 'Já existe um exercício para o ano 2042.' }] });
  });
});

describe('criarExercicio copiando o anterior', () => {
  it('copia posições e pacotes com origem COPIA e recalcula com as premissas do novo ano; receitas e teto ficam', async () => {
    const origem = await exercicioComLancamentos(2060);
    // Premissas do novo ano com outro IPCA (10%): o pacote recalculado prova que vale o ano novo.
    const { d } = deps({ custoPessoal: custoPessoalFalso([{ ...premissasExemplo(2061), versao: 5, ipca: Percentual.dePontos('10') }]) });
    const r = await criarExercicio(ctx(), { ano: 2061, forma: 'COPIA' }, d);
    expect(r).toEqual({ ok: true, valor: { id: expect.any(String), copiadas: { posicoes: 2, pacotes: 3 }, puladas: { posicoes: 0, pacotes: 0 } } });
    const novo = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2061 } });
    expect(novo).toMatchObject({ versaoPremissas: 5, tetoManual: null });
    const posicoes = await migrator.posicaoOrcada.findMany({ where: { exercicioId: novo.id }, orderBy: { cargo: 'asc' } });
    expect(posicoes.map((p) => [p.cargo, p.salarioMensal.toString(), p.origem])).toEqual([
      ['Analista', '7500', 'COPIA'],
      ['Assessor', '7500', 'COPIA'],
    ]);
    const pacotes = await migrator.pacoteBaseZero.findMany({ where: { exercicioId: novo.id } });
    expect(pacotes).toHaveLength(3);
    for (const k of pacotes) {
      expect(k).toMatchObject({ cc: '4.4', conta: '4.1.1.5.005', prioridade: 'IMPORTANTE', quantidade: 12, corrigirIpca: true, distribuicao: 'MENSAL', origem: 'COPIA' });
      expect(k.valorUnitario.toString()).toBe('350');
    }
    const linhas = await migrator.linhaOrcada.findMany({ where: { exercicioId: novo.id, origem: 'BASE_ZERO' } });
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => Dinheiro.de(l.total.toString()).paraString() === '4620.00')).toBe(true); // 12 × 350,00 × 1,10
    expect(await migrator.linhaOrcada.count({ where: { exercicioId: novo.id } })).toBe(5);
    expect(await migrator.receitaRateio.count({ where: { exercicioId: novo.id } })).toBe(0);
    expect(await migrator.posicaoOrcada.count({ where: { exercicioId: origem.id } })).toBe(2);
  });

  it('D-P6-5: pula CC inativo e conta de pessoal, e o Histórico registra as contagens', async () => {
    await exercicioComLancamentos(2062, { ccPosicao: '9.9.9', contaPacote: '4.1.1.1.001' });
    const { d } = deps({ custoPessoal: custoPessoalFalso([premissasExemplo(2063)]) });
    const r = await criarExercicio(ctx(), { ano: 2063, forma: 'COPIA' }, d);
    expect(r.ok && r.valor).toMatchObject({ copiadas: { posicoes: 1, pacotes: 2 }, puladas: { posicoes: 1, pacotes: 1 } });
    const novo = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2063 } });
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { registroId: novo.id } });
    expect(h.descricao).toContain('puladas 1 posições e 1 pacotes');
  });

  it('R18: a origem é o maior ano menor que o novo; sem anterior, mensagem', async () => {
    await exercicioComLancamentos(2070);
    await exercicioComLancamentos(2072);
    const custo = custoPessoalFalso([premissasExemplo(2071)]);
    await criarExercicio(ctx(), { ano: 2071, forma: 'COPIA' }, deps({ custoPessoal: custo }).d);
    const novo = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2071 } });
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { registroId: novo.id } });
    expect(h.descricao).toContain('copiando 2070');
    expect(await criarExercicio(ctx(), { ano: 2001, forma: 'COPIA' }, deps().d)).toEqual({
      ok: false,
      erros: [{ campo: 'forma', mensagem: 'Não há exercício anterior para copiar.' }],
    });
  });

  it('erro de cálculo na cópia: nada é criado (ErroRecalculo desfaz a transação)', async () => {
    await exercicioComLancamentos(2080);
    const custo = custoPessoalFalso([premissasExemplo(2081)]);
    const comErro = { ...custo, calcularCustoPosicao: () => falha([{ campo: 'salarioMensal', mensagem: 'Salário inválido.' }]) };
    const r = await criarExercicio(ctx(), { ano: 2081, forma: 'COPIA' }, deps({ custoPessoal: comErro }).d);
    expect(r.ok).toBe(false);
    expect(await migrator.orcamentoExercicio.findUnique({ where: { ano: 2081 } })).toBeNull();
  });
});

describe('criarExercicio: §10.2', () => {
  it('sem orc.exercicios:incluir e com escopo: ErroPermissao, nada criado', async () => {
    await expect(criarExercicio(ctx(['orc.exercicios:consultar']), { ano: 2090, forma: 'EM_BRANCO' }, deps().d)).rejects.toBeInstanceOf(ErroPermissao);
    await expect(criarExercicio(ctx(), { ano: 2090, forma: 'EM_BRANCO' }, deps({ obterEscopo: async () => '4.3' }).d)).rejects.toBeInstanceOf(ErroPermissao);
    expect(await migrator.orcamentoExercicio.findUnique({ where: { ano: 2090 } })).toBeNull();
  });

  it('auditoria falhando: nada criado', async () => {
    falhaAuditoria.ligada = true;
    await expect(criarExercicio(ctx(), { ano: 2091, forma: 'EM_BRANCO' }, deps().d)).rejects.toThrow('auditoria indisponível');
    expect(await migrator.orcamentoExercicio.findUnique({ where: { ano: 2091 } })).toBeNull();
  });

  it('payload com situacao: violação de governança auditada, nada criado', async () => {
    await expect(criarExercicio(ctx(), { ano: 2092, forma: 'EM_BRANCO', situacao: 'OFICIALIZADO' }, deps().d)).rejects.toEqual(
      expect.objectContaining({ codigo: 'orc.violacao_governanca' }),
    );
    expect(await migrator.orcamentoExercicio.findUnique({ where: { ano: 2092 } })).toBeNull();
    expect(await migrator.historicoOperacao.count({ where: { descricao: 'Tentativa de gravar campo de origem blindada: situacao' } })).toBe(1);
  });

  it('campo desconhecido no payload é recusado pelo schema estrito', async () => {
    expect((await criarExercicio(ctx(), { ano: 2093, forma: 'EM_BRANCO', extra: '1' }, deps().d)).ok).toBe(false);
  });
});

describe('avancarExercicio', () => {
  it('Rascunho → Em Elaboração, com trâmite e Histórico; de novo: mensagem da situação', async () => {
    await criarExercicio(ctx(), { ano: 2094, forma: 'EM_BRANCO' }, deps().d);
    const e = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2094 } });
    expect(await avancarExercicio(ctx(), { id: e.id, versao: String(e.versao) }, deps().d)).toEqual({ ok: true, valor: undefined });
    const depois = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } });
    expect(depois).toMatchObject({ situacao: 'EM_ELABORACAO', versao: e.versao + 1 });
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.exercicios', registroId: e.id, tipoOperacao: 'ALTERACAO' } });
    expect(h).toMatchObject({ unidadeId: null, descricao: 'Exercício 2094: Rascunho → Em Elaboração' });
    expect(await migrator.tramiteExercicio.findMany({ where: { exercicioId: e.id } })).toEqual([
      expect.objectContaining({ de: 'RASCUNHO', para: 'EM_ELABORACAO', usuarioId: USUARIO }),
    ]);
    expect(await avancarExercicio(ctx(), { id: e.id, versao: String(depois.versao) }, deps().d)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Elaboração.' }],
    });
  });

  it('versão velha, sem permissão, com escopo e auditoria falhando', async () => {
    await criarExercicio(ctx(), { ano: 2095, forma: 'EM_BRANCO' }, deps().d);
    const e = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2095 } });
    expect(await avancarExercicio(ctx(), { id: e.id, versao: String(e.versao - 1) }, deps().d)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    await expect(avancarExercicio(ctx(['orc.exercicios:consultar']), { id: e.id, versao: String(e.versao) }, deps().d)).rejects.toBeInstanceOf(ErroPermissao);
    await expect(avancarExercicio(ctx(), { id: e.id, versao: String(e.versao) }, deps({ obterEscopo: async () => '4.3' }).d)).rejects.toBeInstanceOf(ErroPermissao);
    falhaAuditoria.ligada = true;
    await expect(avancarExercicio(ctx(), { id: e.id, versao: String(e.versao) }, deps().d)).rejects.toThrow('auditoria indisponível');
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).situacao).toBe('RASCUNHO');
  });
});

describe('avancarExercicio: governança', () => {
  it('payload com situacao: violação auditada; campo desconhecido ou versão inválida: mensagem', async () => {
    await criarExercicio(ctx(), { ano: 2096, forma: 'EM_BRANCO' }, deps().d);
    const e = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { ano: 2096 } });
    await expect(avancarExercicio(ctx(), { id: e.id, versao: String(e.versao), situacao: 'OFICIALIZADO' }, deps().d)).rejects.toEqual(
      expect.objectContaining({ codigo: 'orc.violacao_governanca' }),
    );
    expect(await avancarExercicio(ctx(), { id: e.id, versao: 'x' }, deps().d)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Versão do registro inválida. Recarregue a tela.' }],
    });
    expect((await avancarExercicio(ctx(), { id: e.id, versao: String(e.versao), extra: '1' }, deps().d)).ok).toBe(false);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).situacao).toBe('RASCUNHO');
  });
});

describe('listarExercicios', () => {
  it('anos em ordem decrescente com a situação; vale orc.orcamento ou orc.exercicios:consultar', async () => {
    await criarExercicio(ctx(), { ano: 2097, forma: 'EM_BRANCO' }, deps().d);
    const l = await listarExercicios(ctx(), deps().d);
    expect(l.map((e) => e.ano)).toEqual([...l.map((e) => e.ano)].sort((a, b) => b - a));
    expect(l.find((e) => e.ano === 2097)).toMatchObject({ situacao: 'RASCUNHO', rotuloSituacao: 'Rascunho' });
    expect((await listarExercicios(ctx(['orc.exercicios:consultar']), deps().d)).length).toBe(l.length);
    await expect(listarExercicios(ctx(['adm.usuarios:consultar']), deps().d)).rejects.toBeInstanceOf(ErroPermissao);
  });
});
