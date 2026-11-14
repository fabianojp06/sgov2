import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { ok, falha } from '@/shared/kernel';
import { emUnidade } from '@/shared/unidade';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_APR as M } from '../domain/solicitacao';
import { criarSolicitacao, decidirSolicitacao, listarTarefas, obterTarefa, pendenteDoAlvo, type Manipuladores, type SolicitacaoDecidivel } from './solicitacoes';

// Solicitações de aprovação e Central de Tarefas (US-078; plano do P26, Task 1). Como sgo_app (RLS real). O alvo
// é a versão de uma proposta de TP criada pelo orc; o manipulador é um falso que registra as chamadas.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

let seq = 0;
let orcamentista: string;
let gfin: string;
let outro: string;
const TAREFAS = ['apr.tarefas:consultar', 'apr.tarefas:executar'];

async function usuario(): Promise<string> {
  const login = `apr${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId: string, permissoes: string[] = TAREFAS): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}

/** Uma unidade de TP nova (o alvo não tem FK) e uma solicitação WA01 enviada pelo orçamentista e roteada ao GFIN. */
async function solicitacao(aprovador = gfin) {
  const numero = `TP-${++seq}/2027`;
  const unidade = await migrator.unidade.create({ data: { codigo: numero, nome: `Unidade ${numero}` } });
  await migrator.usuarioUnidade.create({ data: { usuarioId: orcamentista, unidadeId: unidade.id } });
  const alvoId = crypto.randomUUID();
  const s = await emUnidade(
    await ctx(orcamentista),
    (tx) =>
      criarSolicitacao(
        tx,
        {
          fluxo: 'WA01',
          alvoTipo: 'VERSAO_PROPOSTA',
          alvoId,
          unidadeId: unidade.id,
          descricao: `TP ${numero} · Versão 1`,
          solicitanteId: orcamentista,
          aprovadorId: aprovador,
          papelAprovador: 'TITULAR',
        },
        new Date(),
      ),
    { cliente: app },
  );
  return { ...s, alvoId, numero };
}

const chamadas: { tipo: string; s: SolicitacaoDecidivel; justificativa?: string }[] = [];
const manipuladores = (recusar = false): Manipuladores => ({
  WA01: {
    aoAprovar: async (_tx, s) => {
      chamadas.push({ tipo: 'aprovar', s });
      return recusar ? falha([{ campo: '_', mensagem: 'a proposta mudou' }]) : ok(null);
    },
    aoRejeitar: async (_tx, s, justificativa) => {
      chamadas.push({ tipo: 'rejeitar', s, justificativa });
      return ok(null);
    },
    resumo: async (_tx, s) => [{ rotulo: 'Alvo', valor: s.alvoId }],
  },
});

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
  gfin = await usuario();
  outro = await usuario();
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(() => {
  chamadas.length = 0;
});

describe('criarSolicitacao e listarTarefas (RF_APR_REQ_002)', () => {
  it('vincula o aprovador à unidade (sobe a versão dele); só ele vê a tarefa; pendente bloqueia outra (RN_WA01_009)', async () => {
    const antes = (await migrator.usuario.findUniqueOrThrow({ where: { id: gfin } })).versao;
    const s = await solicitacao();
    expect((await migrator.usuario.findUniqueOrThrow({ where: { id: gfin } })).versao).toBe(antes + 1);
    const [t] = await listarTarefas(await ctx(gfin), {}, { cliente: app });
    expect(t).toMatchObject({ id: s.id, fluxo: 'WA01', situacao: 'EM_APROVACAO', papelAprovador: 'TITULAR', solicitante: expect.stringContaining('Pessoa') });
    expect(await listarTarefas(await ctx(orcamentista), {}, { cliente: app })).toEqual([]);
    expect(await emUnidade(await ctx(gfin), (tx) => pendenteDoAlvo(tx, s.alvoId), { cliente: app })).toBe(true);
    await expect(
      emUnidade(
        await ctx(orcamentista),
        async (tx) =>
          criarSolicitacao(
            tx,
            {
              fluxo: 'WA01',
              alvoTipo: 'VERSAO_PROPOSTA',
              alvoId: s.alvoId,
              unidadeId: (await migrator.solicitacaoAprovacao.findUniqueOrThrow({ where: { id: s.id } })).unidadeId,
              descricao: 'x',
              solicitanteId: orcamentista,
              aprovadorId: gfin,
              papelAprovador: 'TITULAR',
            },
            new Date(),
          ),
        { cliente: app },
      ),
    ).rejects.toThrow();
    expect((await listarTarefas(await ctx(gfin), { situacao: 'APROVADO' }, { cliente: app })).length).toBe(0);
    expect((await listarTarefas(await ctx(gfin), { tp: s.numero }, { cliente: app })).map((x) => x.id)).toEqual([s.id]);
    const aberta = await obterTarefa(await ctx(gfin), s.id, manipuladores(), { cliente: app });
    expect(aberta?.resumo).toEqual([{ rotulo: 'Alvo', valor: s.alvoId }]);
    expect(await obterTarefa(await ctx(outro), s.id, manipuladores(), { cliente: app })).toBeNull();
  });
});

describe('decidirSolicitacao (UC6.00 passo 5 e FA-A)', () => {
  it('rejeitar exige justificativa; com ela, grava e chama o manipulador', async () => {
    const s = await solicitacao();
    const decidir = async (justificativa?: string) =>
      decidirSolicitacao(await ctx(gfin), { id: s.id, versao: 0, decisao: 'REJEITAR', ...(justificativa ? { justificativa } : {}) }, manipuladores(), { cliente: app });
    expect(await decidir()).toEqual({ ok: false, erros: [{ campo: 'justificativa', mensagem: M.JUSTIFICATIVA_CURTA }] });
    expect(await decidir('Falta declarar o rateio de março.')).toEqual({ ok: true, valor: { descricao: `TP ${s.numero} · Versão 1`, decisao: 'REJEITAR' } });
    expect(chamadas.map((c) => [c.tipo, c.justificativa])).toEqual([['rejeitar', 'Falta declarar o rateio de março.']]);
    const g = await migrator.solicitacaoAprovacao.findUniqueOrThrow({ where: { id: s.id } });
    expect(g).toMatchObject({ situacao: 'REJEITADO', justificativa: 'Falta declarar o rateio de março.', versao: 1 });
    expect(g.decididaEm).not.toBeNull();
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'apr.tarefas', registroId: s.id } });
    expect(h).toMatchObject({ depois: { situacao: 'REJEITADO', justificativa: 'Falta declarar o rateio de março.' } });
  });

  it('aprovar; a segunda decisão é a do E6 (Review Focus 2)', async () => {
    const s = await solicitacao();
    const corpo = { id: s.id, versao: 0, decisao: 'APROVAR' };
    const [a, b] = await Promise.all([
      decidirSolicitacao(await ctx(gfin), corpo, manipuladores(), { cliente: app }),
      decidirSolicitacao(await ctx(gfin), { ...corpo, decisao: 'REJEITAR', justificativa: 'Rejeição concorrente da mesma solicitação.' }, manipuladores(), { cliente: app }),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.CONCORRENTE }] });
  });

  it('quem não é o aprovador roteado não decide (Review Focus 3); sem permissão: erro', async () => {
    const s = await solicitacao();
    await migrator.usuarioUnidade.create({ data: { usuarioId: outro, unidadeId: (await migrator.solicitacaoAprovacao.findUniqueOrThrow({ where: { id: s.id } })).unidadeId } });
    expect(await decidirSolicitacao(await ctx(outro), { id: s.id, versao: 0, decisao: 'APROVAR' }, manipuladores(), { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: M.NAO_E_APROVADOR }],
    });
    await expect(decidirSolicitacao(await ctx(gfin, ['apr.tarefas:consultar']), { id: s.id, versao: 0, decisao: 'APROVAR' }, manipuladores(), { cliente: app })).rejects.toThrow();
  });

  it('o manipulador recusa: nada fica gravado (Review Focus 4); sem manipulador do fluxo: recusa', async () => {
    const s = await solicitacao();
    expect(await decidirSolicitacao(await ctx(gfin), { id: s.id, versao: 0, decisao: 'APROVAR' }, manipuladores(true), { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'a proposta mudou' }],
    });
    expect(await migrator.solicitacaoAprovacao.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ situacao: 'EM_APROVACAO', versao: 0, decididaEm: null });
    expect(await decidirSolicitacao(await ctx(gfin), { id: s.id, versao: 0, decisao: 'APROVAR' }, {}, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: M.SEM_MANIPULADOR }],
    });
  });
});

describe('privilégios do apr', () => {
  it('sgo_app insere e lê, sem DELETE; atualiza só a decisão; sgo_sync não toca', async () => {
    const p = await migrator.$queryRaw<{ grantee: string; privilege_type: string }[]>`
      SELECT grantee, privilege_type FROM information_schema.table_privileges WHERE table_name = 'apr_solicitacao' AND grantee IN ('sgo_app', 'sgo_sync') ORDER BY 1, 2`;
    expect(p.map((x) => `${x.grantee}:${x.privilege_type}`)).toEqual(['sgo_app:INSERT', 'sgo_app:SELECT']);
    const c = await migrator.$queryRaw<{ coluna: string }[]>`
      SELECT column_name AS coluna FROM information_schema.column_privileges WHERE grantee = 'sgo_app' AND table_name = 'apr_solicitacao' AND privilege_type = 'UPDATE' ORDER BY 1`;
    expect(c.map((x) => x.coluna)).toEqual(['decidida_em', 'justificativa', 'situacao', 'versao']);
  });
});
