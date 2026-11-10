import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { ConflitoConcorrencia, ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_SISTEMA } from '../domain/sistema';
import { seedAdm } from '../infrastructure/seed';
import { ativarSistema, desativarSistema, listarAtivacoes, obterEstadoSistema } from './sistema';

// Ativar e desativar o sistema (US-036, UC02.01; plano do P9, Task 2): motivo obrigatório, contagem
// pelo instante gravado (D-P9-2), cancelamento pela ativação, trava contra a corrida (D-P9-6) e o
// histórico da tela (REQ0053).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let agora = new Date('2026-11-11T12:00:00.000Z');
const deps = () => ({ cliente: app, agora: () => agora });
const PERMISSOES = ['adm.sistema:consultar', 'adm.sistema:alterar'];
let ctx: ContextoRequisicao;
let outro: ContextoRequisicao;

async function usuario(login: string): Promise<string> {
  const u = await migrator.usuario.create({
    data: { nome: `Nome ${login}`, email: `${login}@example.org`, login, loginNormalizado: login, senhaHash: 'x', trocaSenhaObrigatoria: false },
  });
  return u.id;
}

const config = () => migrator.configuracaoAcesso.findUniqueOrThrow({ where: { id: 1 } });
const historico = () =>
  migrator.historicoOperacao.findMany({
    where: { funcionalidade: 'adm.sistema' },
    orderBy: { id: 'asc' },
    select: { tipoOperacao: true, usuarioId: true, descricao: true, antes: true, depois: true },
  });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  ctx = { usuarioId: await usuario('adm.sistema'), usuarioRotulo: 'adm.sistema', sessaoUid: 's1', ip: null, permissoes: new Set(PERMISSOES) };
  outro = { usuarioId: await usuario('adm.outro'), usuarioRotulo: 'adm.outro', sessaoUid: 's2', ip: null, permissoes: new Set(PERMISSOES) };
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(async () => {
  agora = new Date('2026-11-11T12:00:00.000Z');
  await migrator.configuracaoAcesso.update({
    where: { id: 1 },
    data: { manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null, desconexaoEsperaMin: 5 },
  });
});

describe('desativar (UC02.01 FA1)', () => {
  it.each([[''], ['   '], [undefined]])('motivo %j → E1 (RN0073) e nada muda', async (motivo) => {
    const antes = (await historico()).length;
    const r = desativarSistema(ctx, { motivo }, deps());
    await expect(r).rejects.toBeInstanceOf(ErroDominio);
    await expect(desativarSistema(ctx, { motivo }, deps())).rejects.toThrow(MENSAGENS_SISTEMA.MOTIVO_OBRIGATORIO);
    expect(await config()).toMatchObject({ manutencao: false, manutencaoAPartir: null });
    expect(await historico()).toHaveLength(antes);
  });

  it('grava o indicador, o instante (relógio injetado + espera), o motivo e o autor, com o Histórico', async () => {
    const antes = (await historico()).length;
    const r = await desativarSistema(ctx, { motivo: '  Virada do exercício  ' }, deps());
    const em = new Date('2026-11-11T12:05:00.000Z');
    expect(r).toEqual({ desativacaoEm: em });
    expect(await config()).toMatchObject({ manutencao: true, manutencaoAPartir: em, manutencaoMotivo: 'Virada do exercício', manutencaoPorId: ctx.usuarioId });
    const h = (await historico()).slice(antes);
    expect(h).toEqual([
      {
        tipoOperacao: 'ALTERACAO',
        usuarioId: ctx.usuarioId,
        descricao: 'Desativação do sistema. Motivo: Virada do exercício',
        antes: { status: 'ATIVO' },
        depois: { status: 'INATIVO', desativacaoEm: em.toISOString(), motivo: 'Virada do exercício' },
      },
    ]);
  });

  it('antes do instante o sistema continua ativo, com a desativação marcada; depois, inativo', async () => {
    await desativarSistema(ctx, { motivo: 'Manutenção' }, deps());
    const em = new Date('2026-11-11T12:05:00.000Z');
    agora = new Date('2026-11-11T12:04:59.000Z');
    expect(await obterEstadoSistema(app, agora)).toEqual({ ativo: true, desativacaoEm: em, motivo: 'Manutenção', por: ctx.usuarioId });
    agora = em;
    expect(await obterEstadoSistema(app, agora)).toMatchObject({ ativo: false, desativacaoEm: em });
  });

  it('com espera zero, vale na hora', async () => {
    await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { desconexaoEsperaMin: 0 } });
    expect(await desativarSistema(ctx, { motivo: 'Agora' }, deps())).toEqual({ desativacaoEm: agora });
    expect((await obterEstadoSistema(app, agora)).ativo).toBe(false);
  });

  it('desativar de novo (na contagem ou já inativo) → conflito', async () => {
    await desativarSistema(ctx, { motivo: 'Primeira' }, deps());
    await expect(desativarSistema(outro, { motivo: 'Segunda' }, deps())).rejects.toBeInstanceOf(ConflitoConcorrencia);
    agora = new Date('2026-11-11T13:00:00.000Z');
    await expect(desativarSistema(outro, { motivo: 'Terceira' }, deps())).rejects.toBeInstanceOf(ConflitoConcorrencia);
    expect((await config()).manutencaoMotivo).toBe('Primeira');
  });

  it('duas desativações em paralelo: uma vale, a outra recebe ConflitoConcorrencia (trava adm:sistema)', async () => {
    const antes = (await historico()).length;
    const r = await Promise.allSettled([desativarSistema(ctx, { motivo: 'A' }, deps()), desativarSistema(outro, { motivo: 'B' }, deps())]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusada = r.find((x) => x.status === 'rejected');
    expect(recusada?.status === 'rejected' && recusada.reason).toBeInstanceOf(ConflitoConcorrencia);
    expect((await historico()).slice(antes)).toHaveLength(1);
  });

  it('sem a permissão → ErroPermissao', async () => {
    const semPermissao = { ...ctx, permissoes: new Set(['adm.sistema:consultar']) };
    await expect(desativarSistema(semPermissao, { motivo: 'X' }, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(ativarSistema(semPermissao, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('ativar (UC02.01 fluxo principal)', () => {
  it('com o sistema inativo: desliga tudo e grava o Histórico', async () => {
    await desativarSistema(ctx, { motivo: 'Fechamento' }, deps());
    agora = new Date('2026-11-11T12:10:00.000Z');
    const antes = (await historico()).length;
    await ativarSistema(outro, deps());
    expect(await config()).toMatchObject({ manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null });
    expect((await historico()).slice(antes)).toEqual([
      {
        tipoOperacao: 'ALTERACAO',
        usuarioId: outro.usuarioId,
        descricao: 'Ativação do sistema',
        antes: { status: 'INATIVO', desativacaoEm: '2026-11-11T12:05:00.000Z', motivo: 'Fechamento' },
        depois: { status: 'ATIVO' },
      },
    ]);
  });

  it('durante a contagem: cancela a desativação, com o Histórico', async () => {
    await desativarSistema(ctx, { motivo: 'Engano' }, deps());
    const antes = (await historico()).length;
    await ativarSistema(ctx, deps());
    expect(await config()).toMatchObject({ manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null });
    expect((await historico()).slice(antes)).toMatchObject([{ descricao: 'Ativação do sistema (desativação agendada cancelada)', depois: { status: 'ATIVO' } }]);
    expect((await obterEstadoSistema(app, agora)).desativacaoEm).toBeNull();
  });

  it('com o sistema ativo e sem contagem → conflito', async () =>
    expect(ativarSistema(ctx, deps())).rejects.toBeInstanceOf(ConflitoConcorrencia));

  it('manutenção ligada direto no banco (instante nulo): inativa na hora, e ativar desliga', async () => {
    await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: true } });
    expect(await obterEstadoSistema(app, agora)).toEqual({ ativo: false, desativacaoEm: null, motivo: null, por: null });
    await ativarSistema(ctx, deps());
    expect((await obterEstadoSistema(app, agora)).ativo).toBe(true);
  });

  it('desativar e ativar ao mesmo tempo: estado final coerente com o Histórico na ordem', async () => {
    const antes = (await historico()).length;
    await Promise.allSettled([desativarSistema(ctx, { motivo: 'Corrida' }, deps()), ativarSistema(outro, deps())]);
    const h = (await historico()).slice(antes);
    const c = await config();
    // Ou a ativação veio primeiro (conflito) e a desativação vale; ou as duas valem, nesta ordem.
    if (h.length === 1) {
      expect(h[0]?.descricao).toContain('Desativação');
      expect(c.manutencao).toBe(true);
    } else {
      expect(h.map((x) => x.descricao)).toEqual(['Desativação do sistema. Motivo: Corrida', 'Ativação do sistema (desativação agendada cancelada)']);
      expect(c.manutencao).toBe(false);
    }
  });
});

describe('listarAtivacoes (REQ0053)', () => {
  it('do Histórico, mais recente primeiro, com o tipo, o motivo e o nome do usuário', async () => {
    await desativarSistema(ctx, { motivo: 'Lista 1' }, deps());
    await ativarSistema(outro, deps());
    const lista = await listarAtivacoes(ctx, deps());
    expect(lista.slice(0, 2)).toMatchObject([
      { tipo: 'Ativação', motivo: null, usuario: 'Nome adm.outro' },
      { tipo: 'Desativação', motivo: 'Lista 1', usuario: 'Nome adm.sistema' },
    ]);
    expect(lista[0]?.em).toBeInstanceOf(Date);
  });

  it('negações da guarda (tipo SISTEMA) não entram na lista', async () => {
    await migrator.historicoOperacao.create({
      data: { usuarioRotulo: 'x', funcionalidade: 'adm.sistema', tipoOperacao: 'SISTEMA', descricao: 'Acesso negado à funcionalidade adm.sistema (alterar)', origem: 'SISTEMA' },
    });
    expect((await listarAtivacoes(ctx, deps())).every((l) => l.tipo === 'Ativação' || l.tipo === 'Desativação')).toBe(true);
    expect((await listarAtivacoes(ctx, deps())).some((l) => l.usuario === 'x')).toBe(false);
  });

  it('sem consultar → ErroPermissao', async () =>
    expect(listarAtivacoes({ ...ctx, permissoes: new Set() }, deps())).rejects.toBeInstanceOf(ErroPermissao));
});
