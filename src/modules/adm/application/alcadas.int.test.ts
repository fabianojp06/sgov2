import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ALCADA } from '../domain/alcada';
import { seedAdm } from '../infrastructure/seed';
import { alterarAlcada, cadastrarAlcada, inativarAlcada, listarAlcadas } from './alcadas';
import { resolverAprovador } from './roteamento-alcada';

// Alçadas de aprovação (US-042, §11.4): cadastro, troca de aprovador por inativação, soft delete e o
// roteamento titular → substituto (RN_ALC_005), com o bloqueio do mesmo usuário (RN_WA02_006).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
const deps = () => ({ cliente: app, agora: () => AGORA });
const PERMISSOES = ['adm.alcadas:consultar', 'adm.alcadas:incluir', 'adm.alcadas:alterar', 'adm.alcadas:excluir'];
let ctx: ContextoRequisicao;

async function usuario(login: string, ativo = true): Promise<string> {
  const u = await migrator.usuario.create({
    data: { nome: `Nome ${login}`, email: `${login}@example.org`, login, loginNormalizado: login, senhaHash: 'x', trocaSenhaObrigatoria: false, ativo },
  });
  return u.id;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  const admin = await usuario('adm.alcadas');
  ctx = { usuarioId: admin, usuarioRotulo: 'adm.alcadas', sessaoUid: 's1', ip: null, permissoes: new Set(PERMISSOES) };
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

const historico = (registroId: string) =>
  migrator.historicoOperacao.findMany({ where: { funcionalidade: 'adm.alcadas', registroId }, orderBy: { id: 'asc' }, select: { tipoOperacao: true, antes: true, depois: true } });

describe('cadastro (§11.4)', () => {
  it('titular e substituto ativos e diferentes → gravada, ativa, com o Histórico', async () => {
    const [t, s] = [await usuario('tit.wa01'), await usuario('sub.wa01')];
    const r = await cadastrarAlcada(ctx, { fluxo: 'WA01', titularId: t, substitutoId: s }, deps());
    expect(r.ok).toBe(true);
    const id = r.ok ? r.valor.id : '';
    expect(await migrator.alcadaAprovacao.findUniqueOrThrow({ where: { id } })).toMatchObject({ fluxo: 'WA01', titularId: t, substitutoId: s, ativa: true, inativadaEm: null, versao: 1 });
    expect(await historico(id)).toEqual([{ tipoOperacao: 'INSERCAO', antes: null, depois: { fluxo: 'WA01', titularId: t, substitutoId: s } }]);
  });

  it('usuário inativo → erro no campo; segunda alçada ativa do mesmo fluxo → duplicada', async () => {
    const [t, s, inativo] = [await usuario('tit.wa02'), await usuario('sub.wa02'), await usuario('ina.wa02', false)];
    expect(await cadastrarAlcada(ctx, { fluxo: 'WA02', titularId: inativo, substitutoId: s }, deps())).toEqual({
      ok: false,
      erros: [{ campo: 'titularId', mensagem: MENSAGENS_ALCADA.DIFERENTES }],
    });
    expect((await cadastrarAlcada(ctx, { fluxo: 'WA02', titularId: t, substitutoId: s }, deps())).ok).toBe(true);
    expect(await cadastrarAlcada(ctx, { fluxo: 'WA02', titularId: s, substitutoId: t }, deps())).toEqual({
      ok: false,
      erros: [{ campo: 'fluxo', mensagem: MENSAGENS_ALCADA.DUPLICADA }],
    });
  });

  it('sem a permissão → ErroPermissao', async () => {
    const semPermissao = { ...ctx, permissoes: new Set(['adm.alcadas:consultar']) };
    await expect(cadastrarAlcada(semPermissao, { fluxo: 'WA05', titularId: ctx.usuarioId, substitutoId: ctx.usuarioId }, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('troca de aprovador e exclusão (D-P8-7, soft delete)', () => {
  it('trocar o titular inativa a linha antiga e cria outra; a versão velha é recusada; excluir só inativa', async () => {
    const [t, s, novo] = [await usuario('tit.wa05'), await usuario('sub.wa05'), await usuario('novo.wa05')];
    const r = await cadastrarAlcada(ctx, { fluxo: 'WA05', titularId: t, substitutoId: s }, deps());
    const antiga = r.ok ? r.valor.id : '';
    const troca = await alterarAlcada(ctx, antiga, 1, { titularId: novo, substitutoId: s }, deps());
    expect(troca.ok).toBe(true);
    const nova = troca.ok ? troca.valor.id : '';
    expect(nova).not.toBe(antiga);
    expect(await migrator.alcadaAprovacao.findUniqueOrThrow({ where: { id: antiga } })).toMatchObject({ ativa: false, inativadaEm: AGORA, versao: 2 });
    expect(await migrator.alcadaAprovacao.findUniqueOrThrow({ where: { id: nova } })).toMatchObject({ ativa: true, titularId: novo });
    expect((await historico(antiga)).map((h) => h.tipoOperacao)).toEqual(['INSERCAO', 'ALTERACAO']);
    expect((await historico(nova)).map((h) => h.tipoOperacao)).toEqual(['INSERCAO']);
    expect(await alterarAlcada(ctx, antiga, 1, { titularId: t, substitutoId: s }, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_ALCADA.ALTERADO }] });

    expect(await inativarAlcada(ctx, nova, 1, deps())).toEqual({ ok: true, valor: undefined });
    expect(await migrator.alcadaAprovacao.findUniqueOrThrow({ where: { id: nova } })).toMatchObject({ ativa: false, versao: 2 });
    expect((await historico(nova)).map((h) => h.tipoOperacao)).toEqual(['INSERCAO', 'EXCLUSAO']);
    // As três linhas do fluxo continuam no banco (quem aprovava em cada período).
    expect(await migrator.alcadaAprovacao.count({ where: { fluxo: 'WA05' } })).toBe(2);
    const lista = await listarAlcadas(ctx, deps());
    expect(lista.filter((l) => l.fluxo === 'WA05').every((l) => !l.ativa)).toBe(true);
  });

  it('o banco recusa DELETE da aplicação (soft delete)', async () => {
    await expect(app.$executeRaw`DELETE FROM adm_alcada_aprovacao`).rejects.toThrow(/permission denied/);
  });
});

describe('resolverAprovador (RN_ALC_005, RN_WA02_006)', () => {
  it('titular ativo → TITULAR; titular inativado depois → SUBSTITUTO; os dois inativos ou sem alçada → null; solicitante = escolhido → bloqueio', async () => {
    const [t, s] = [await usuario('tit.rota'), await usuario('sub.rota')];
    // WA01 já tem alçada ativa de outro teste: usa um banco limpo para o fluxo inativando as ativas.
    await migrator.$executeRaw`UPDATE adm_alcada_aprovacao SET ativa = false, inativada_em = now() WHERE fluxo = 'WA01' AND ativa`;
    expect(await app.$transaction((tx) => resolverAprovador(tx, 'WA01'))).toBeNull();
    await cadastrarAlcada(ctx, { fluxo: 'WA01', titularId: t, substitutoId: s }, deps());
    const rota = (o?: { solicitanteId?: string }) => app.$transaction((tx) => resolverAprovador(tx, 'WA01', o));
    expect(await rota()).toEqual({ usuarioId: t, papel: 'TITULAR' });
    expect(await rota({ solicitanteId: t })).toEqual({ bloqueio: 'MESMO_USUARIO' });
    await migrator.usuario.update({ where: { id: t }, data: { ativo: false } });
    expect(await rota()).toEqual({ usuarioId: s, papel: 'SUBSTITUTO' });
    expect(await rota({ solicitanteId: s })).toEqual({ bloqueio: 'MESMO_USUARIO' });
    await migrator.usuario.update({ where: { id: s }, data: { ativo: false } });
    expect(await rota()).toBeNull();
  });
});
