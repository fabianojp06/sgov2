import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Percentual } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { obterVisaoExercicio } from './consolidacao';
import type { DepsOrc, FaixasSemaforo } from './deps';
import { definirTeto } from './teto';

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

// Teto e painel do exercício (US-059; plano do P6, Task 7).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2030;

const ctx = (permissoes: string[] = ['orc.orcamento:consultar', 'orc.orcamento:alterar', 'cad.parametros:consultar']): ContextoRequisicao => ({
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  permissoes: new Set(permissoes),
});
const faixas: FaixasSemaforo = { verdeAte: Percentual.dePontos('70'), amareloAte: Percentual.dePontos('85'), laranjaAte: Percentual.dePontos('95') };
const semaforo = {
  faixas: async () => faixas,
  classificar: (uso: Percentual | null, f: FaixasSemaforo) => {
    if (!uso) return null;
    const v = Number(uso.paraString());
    return v <= Number(f.verdeAte.paraString()) ? 'VERDE' : v <= Number(f.amareloAte.paraString()) ? 'AMARELO' : v <= Number(f.laranjaAte.paraString()) ? 'LARANJA' : 'VERMELHO';
  },
} as const;

async function exercicio(receitaMes = '100000.00') {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a, versaoPremissas: 1 } });
  await migrator.receitaRateio.create({ data: { exercicioId: e.id, tp: '001', descricao: '', situacao: 'CONFIRMADO', meses: Array(12).fill(receitaMes), total: (Number(receitaMes) * 12).toFixed(2) } });
  await migrator.receitaRateio.create({ data: { exercicioId: e.id, tp: '002', descricao: '', situacao: 'PREVISTO', meses: Array(12).fill('50000.00'), total: '600000.00' } });
  // Despesa de 90.000,00/mês numa linha de pacote (4.4).
  const p = await migrator.pacoteBaseZero.create({
    data: { exercicioId: e.id, cc: '4.4', conta: '4.1.1.5.005', justificativa: 'Reposição de material', prioridade: 'ESSENCIAL', quantidade: 12, valorUnitario: '90000.00', corrigirIpca: false, distribuicao: 'MENSAL', origem: 'IMPORTACAO' },
  });
  await migrator.linhaOrcada.create({ data: { exercicioId: e.id, cc: '4.4', conta: '4.1.1.5.005', origem: 'BASE_ZERO', pacoteId: p.id, meses: Array(12).fill('90000.00'), total: '1080000.00' } });
  const deps = (d: Partial<DepsOrc> = {}): Partial<DepsOrc> => ({
    cliente: app,
    estrutura: estruturaFinanceiraFalsa(),
    custoPessoal: custoPessoalFalso([premissasExemplo(a)]),
    obterEscopo: async () => null,
    semaforo,
    ...d,
  });
  return { ...e, ano: a, deps };
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

describe('painel na visão', () => {
  it('resultado 120.000,00, teto padrão, uso 90 → Laranja; a prevista fora', async () => {
    const e = await exercicio();
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps()))!;
    expect(v.painel?.resultadoAno.paraString()).toBe('120000.00');
    expect(v.painel?.tetoEfetivo.paraString()).toBe('1200000.00');
    expect(v.painel?.uso?.paraString()).toBe('90.00');
    expect(v.painel?.semaforo).toBe('LARANJA');
  });

  it('com escopo: sem painel; sem cad.parametros:consultar: sem semáforo e com aviso; sem provedor: aviso', async () => {
    const e = await exercicio();
    expect((await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ obterEscopo: async () => '4.4' })))!.painel).toBeNull();
    const sem = (await obterVisaoExercicio(ctx(['orc.orcamento:consultar']), e.ano, null, e.deps()))!;
    expect(sem.painel?.semaforo).toBeNull();
    expect(sem.avisos).toContain('Sem permissão para ver as faixas do semáforo.');
    const semProvedor = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps({ semaforo: null })))!;
    expect(semProvedor.avisos).toContain('As faixas do semáforo ainda não estão disponíveis.');
  });
});

describe('definirTeto', () => {
  it('teto manual menor: gravado, auditado (antes e depois, sem TP), versão sobe; visão com uso 108 → Vermelho', async () => {
    const e = await exercicio();
    expect(await definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '1.000.000,00', justificativa: '' }, e.deps())).toEqual({ ok: true, valor: { ano: e.ano } });
    const ex = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } });
    expect(ex.tetoManual?.toString()).toBe('1000000');
    expect(ex.versao).toBe(1);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.orcamento', registroId: e.id } });
    expect(h).toMatchObject({ tipoOperacao: 'ALTERACAO', unidadeId: null });
    expect(h.depois).toMatchObject({ tetoManual: '1000000.00' });
    const v = (await obterVisaoExercicio(ctx(), e.ano, null, e.deps()))!;
    expect(v.painel?.uso?.paraString()).toBe('108.00');
    expect(v.painel?.semaforo).toBe('VERMELHO');
    expect(v.painel?.saldo.paraString()).toBe('-80000.00');
  });

  it('acima da receita: justificativa exigida; com 15 caracteres, aceita; vazio volta ao padrão', async () => {
    const e = await exercicio();
    expect(await definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '1.300.000,00' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: 'justificativa', mensagem: 'Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres.' }],
    });
    expect((await definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '1.300.000,00', justificativa: 'Convênio extra assinado' }, e.deps())).ok).toBe(true);
    expect((await definirTeto(ctx(), { exercicioId: e.id, versao: '1', teto: '' }, e.deps())).ok).toBe(true);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).tetoManual).toBeNull();
  });

  it('formato inválido, zero, versão velha e exercício Em Aprovação', async () => {
    const e = await exercicio();
    expect(await definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '1.00' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: 'teto', mensagem: 'Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.' }],
    });
    expect(await definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '0' }, e.deps())).toEqual({ ok: false, erros: [{ campo: 'teto', mensagem: 'O teto precisa ser maior que zero.' }] });
    expect(await definirTeto(ctx(), { exercicioId: e.id, versao: '7', teto: '10' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = ${e.id}::uuid`;
    expect(await definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '10' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }],
    });
  });

  it('§10.2: sem permissão, com escopo, auditoria falhando e campo blindado', async () => {
    const e = await exercicio();
    await expect(definirTeto(ctx(['orc.orcamento:consultar']), { exercicioId: e.id, versao: '0', teto: '10' }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '10' }, e.deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    await expect(definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '10', tetoEfetivo: '1' }, e.deps())).rejects.toEqual(
      expect.objectContaining({ codigo: 'orc.violacao_governanca' }),
    );
    falhaAuditoria.ligada = true;
    await expect(definirTeto(ctx(), { exercicioId: e.id, versao: '0', teto: '10' }, e.deps())).rejects.toThrow('auditoria indisponível');
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).tetoManual).toBeNull();
  });
});
