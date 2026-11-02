import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { custoPessoalFalso, estruturaFinanceiraFalsa } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { DepsOrc } from './deps';
import { alterarReceita, excluirReceita, incluirReceita, listarReceitas, obterReceita } from './receitas';

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

// Receitas do rateio dos TPs digitadas na transição (US-060; C35; plano do P6, Task 5).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2030;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const GFIN = ['orc.receitas:consultar', 'orc.receitas:incluir', 'orc.receitas:alterar', 'orc.receitas:excluir'];
const ctx = (permissoes: string[] = GFIN): ContextoRequisicao => ({
  usuarioId: USUARIO,
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  permissoes: new Set(permissoes),
});
const deps = (extra: Partial<DepsOrc> = {}): Partial<DepsOrc> => ({
  cliente: app,
  estrutura: estruturaFinanceiraFalsa(),
  custoPessoal: custoPessoalFalso([]),
  obterEscopo: async () => null,
  ...extra,
});
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const dados = (extra: Record<string, string> = {}) => ({
  tp: '001/2026',
  descricao: 'Contrato de apoio técnico',
  situacao: 'Confirmado',
  ...Object.fromEntries(MESES.map((m) => [m, '1.000,50'])),
  ...extra,
});
const exercicio = () => migrator.orcamentoExercicio.create({ data: { ano: ano++ } });
const din = (v: { toString(): string }) => Dinheiro.de(v.toString()).paraString();

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

describe('incluirReceita', () => {
  it('grava com origem MANUAL_TRANSICAO e total do servidor (valores no formato brasileiro); audita sem TP; versão do exercício sobe', async () => {
    const e = await exercicio();
    const r = await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    expect(r).toEqual({ ok: true, valor: { id: expect.any(String), ano: e.ano } });
    const rec = await migrator.receitaRateio.findUniqueOrThrow({ where: { id: r.ok ? r.valor.id : '' } });
    expect(rec).toMatchObject({ origem: 'MANUAL_TRANSICAO', situacao: 'CONFIRMADO', tp: '001/2026' });
    expect(din(rec.total)).toBe('12006.00');
    expect(rec.meses.map(din)).toEqual(Array(12).fill('1000.50'));
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.receitas', registroId: rec.id } });
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', unidadeId: null });
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao).toBe(1);
  });

  it('erros da validação com o nome do campo do formulário; TP repetido no exercício', async () => {
    const e = await exercicio();
    expect(await incluirReceita(ctx(), { ...dados({ tp: ' ', fev: '-1', mar: '7.500,001' }), exercicioId: e.id }, deps())).toEqual({
      ok: false,
      erros: [
        { campo: 'tp', mensagem: 'TP / versão obrigatório.' },
        { campo: 'fev', mensagem: 'Valor do mês não pode ser negativo.' },
        { campo: 'mar', mensagem: 'Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.' },
      ],
    });
    await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    expect(await incluirReceita(ctx(), { ...dados({ situacao: 'Previsto' }), exercicioId: e.id }, deps())).toEqual({
      ok: false,
      erros: [{ campo: 'tp', mensagem: 'Já existe receita do TP 001/2026 neste exercício.' }],
    });
  });

  it('exercício Em Aprovação: mensagem da situação', async () => {
    const e = await exercicio();
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = ${e.id}::uuid`;
    expect(await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }],
    });
  });

  it('§10.2: sem permissão, com escopo, auditoria falhando e campo blindado', async () => {
    const e = await exercicio();
    await expect(incluirReceita(ctx(['orc.receitas:consultar']), { ...dados(), exercicioId: e.id }, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    falhaAuditoria.ligada = true;
    await expect(incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps())).rejects.toThrow('auditoria indisponível');
    falhaAuditoria.ligada = false;
    for (const campo of ['origem', 'total', 'liquido', 'iss', 'importacaoId']) {
      await expect(incluirReceita(ctx(), { ...dados(), exercicioId: e.id, [campo]: '1' }, deps())).rejects.toEqual(
        expect.objectContaining({ codigo: 'orc.violacao_governanca' }),
      );
    }
    expect(await migrator.receitaRateio.count({ where: { exercicioId: e.id } })).toBe(0);
  });
});

describe('alterarReceita e excluirReceita', () => {
  it('altera com a versão; versão velha → concorrência; antes e depois no Histórico', async () => {
    const e = await exercicio();
    const r = await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    const id = r.ok ? r.valor.id : '';
    expect(await alterarReceita(ctx(), { ...dados({ situacao: 'Previsto', jan: '0' }), id, versao: '0' }, deps())).toEqual({ ok: true, valor: { ano: e.ano } });
    const rec = await migrator.receitaRateio.findUniqueOrThrow({ where: { id } });
    expect(rec).toMatchObject({ situacao: 'PREVISTO', versao: 1 });
    expect(din(rec.total)).toBe('11005.50');
    expect(await alterarReceita(ctx(), { ...dados(), id, versao: '0' }, deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { registroId: id, tipoOperacao: 'ALTERACAO' } });
    expect(h.antes).toMatchObject({ situacao: 'CONFIRMADO' });
    expect(h.depois).toMatchObject({ situacao: 'PREVISTO' });
  });

  it('TP repetido na alteração; exclusão com a versão; inexistente', async () => {
    const e = await exercicio();
    await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    const b = await incluirReceita(ctx(), { ...dados({ tp: '002/2026' }), exercicioId: e.id }, deps());
    const id = b.ok ? b.valor.id : '';
    expect(await alterarReceita(ctx(), { ...dados(), id, versao: '0' }, deps())).toEqual({
      ok: false,
      erros: [{ campo: 'tp', mensagem: 'Já existe receita do TP 001/2026 neste exercício.' }],
    });
    expect(await excluirReceita(ctx(), { id, versao: '5' }, deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    expect(await excluirReceita(ctx(), { id, versao: '0' }, deps())).toEqual({ ok: true, valor: { ano: e.ano } });
    expect(await migrator.historicoOperacao.count({ where: { registroId: id, tipoOperacao: 'EXCLUSAO' } })).toBe(1);
    await expect(excluirReceita(ctx(), { id, versao: '0' }, deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.receita_inexistente' }));
  });

  it('§10.2: sem permissão, com escopo e auditoria falhando, na alteração e na exclusão', async () => {
    const e = await exercicio();
    const r = await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    const id = r.ok ? r.valor.id : '';
    await expect(alterarReceita(ctx(['orc.receitas:incluir']), { ...dados(), id, versao: '0' }, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(excluirReceita(ctx(['orc.receitas:incluir']), { id, versao: '0' }, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(excluirReceita(ctx(), { id, versao: '0' }, deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    falhaAuditoria.ligada = true;
    await expect(alterarReceita(ctx(), { ...dados({ jan: '1' }), id, versao: '0' }, deps())).rejects.toThrow('auditoria indisponível');
    await expect(excluirReceita(ctx(), { id, versao: '0' }, deps())).rejects.toThrow('auditoria indisponível');
    expect((await migrator.receitaRateio.findUniqueOrThrow({ where: { id } })).versao).toBe(0);
  });
});

describe('alterar e excluir: governança e exercício não editável', () => {
  it('campos blindados recusados também na alteração e na exclusão; "1.00" na tela é formato inválido', async () => {
    const e = await exercicio();
    const r = await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    const id = r.ok ? r.valor.id : '';
    for (const campo of ['origem', 'total', 'iss']) {
      await expect(alterarReceita(ctx(), { ...dados(), id, versao: '0', [campo]: '1' }, deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
      await expect(excluirReceita(ctx(), { id, versao: '0', [campo]: '1' }, deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    }
    expect(await alterarReceita(ctx(), { ...dados({ fev: '1.00' }), id, versao: '0' }, deps())).toEqual({
      ok: false,
      erros: [{ campo: 'fev', mensagem: 'Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.' }],
    });
  });

  it('exercício Em Aprovação: alterar e excluir recusados com a mensagem da situação', async () => {
    const e = await exercicio();
    const r = await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    const id = r.ok ? r.valor.id : '';
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO' WHERE id = ${e.id}::uuid`;
    const situacao = { ok: false, erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }] };
    expect(await alterarReceita(ctx(), { ...dados(), id, versao: '0' }, deps())).toEqual(situacao);
    expect(await excluirReceita(ctx(), { id, versao: '0' }, deps())).toEqual(situacao);
    expect((await listarReceitas(ctx(), e.id, deps())).editavel).toBe(false);
  });
});

describe('listarReceitas e obterReceita', () => {
  it('confirmadas e previstas separadas, totais por mês sem drift, ISS a definir e líquido = rateio', async () => {
    const e = await exercicio();
    await incluirReceita(ctx(), { ...dados(), exercicioId: e.id }, deps());
    await incluirReceita(ctx(), { ...dados({ tp: '002/2026', jan: '0,01' }), exercicioId: e.id }, deps());
    await incluirReceita(ctx(), { ...dados({ tp: '003/2026', situacao: 'Previsto' }), exercicioId: e.id }, deps());
    const l = await listarReceitas(ctx(), e.id, deps());
    expect(l.confirmadas.map((r) => r.tp)).toEqual(['001/2026', '002/2026']);
    expect(l.previstas.map((r) => r.tp)).toEqual(['003/2026']);
    expect(l.totalConfirmadoMes[0]!.paraString()).toBe('1000.51');
    expect(l.totalConfirmadoMes[1]!.paraString()).toBe('2001.00');
    expect(l.confirmadas[0]).toMatchObject({ iss: 'a definir', origem: 'MANUAL_TRANSICAO' });
    expect(l.confirmadas[0]!.liquido.paraString()).toBe(l.confirmadas[0]!.total.paraString());
    expect(Dinheiro.somarTodos(l.totalConfirmadoMes).paraString()).toBe(Dinheiro.somarTodos(l.confirmadas.map((r) => r.total)).paraString());
    expect(l.editavel).toBe(true);
    const o = await obterReceita(ctx(), l.confirmadas[0]!.id, deps());
    expect(o?.meses[0]).toBe('1.000,50');
  });

  it('com escopo ou sem consultar: ErroPermissao', async () => {
    const e = await exercicio();
    await expect(listarReceitas(ctx(), e.id, deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    await expect(listarReceitas(ctx(['orc.orcamento:consultar']), e.id, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});
