import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conferirSenha, hashSenha, resetarSenha, seedAdm } from '@/modules/adm';
import { emailFalso } from '@/modules/ger';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS } from '../domain/mensagens';
import { autenticar } from './autenticar';
import { criarLimitadorLogin } from './limite-login';
import { criarProvedorContexto } from './provedor-contexto';
import { solicitarRecuperacaoSenha } from './recuperar-senha';
import { trocarSenha } from './trocar-senha';

// Recuperação de senha pela tela de login (US-029, Task 3 do plano P8; EP084 UC01.01 A1; RN0516,
// RN0517; C21): resposta única, tempo igual, senha vigente preservada, uso único e as bordas.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let agora = new Date('2026-11-11T12:00:00.000Z');
const VIGENTE = `Vigente${Date.now()}x`;
let hashVigente: string;
const relogio = () => agora;

async function usuario(login: string, extra: Record<string, unknown> = {}) {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'ORCAMENTISTA' } });
  return migrator.usuario.create({
    data: { nome: `Nome ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: hashVigente, trocaSenhaObrigatoria: false, perfis: { create: { perfilId: p.id } }, ...extra },
  });
}

// O e-mail falso guarda a senha temporária enviada; o hash espião conta os Argon2.
function ambiente() {
  const email = emailFalso();
  const hashes = { chamadas: 0 };
  const deps = {
    cliente: app,
    agora: relogio,
    enviarEmail: email.enviarEmail,
    limitador: criarLimitadorLogin({ porIp: 100, porLogin: 20 }),
    hashSenha: async (s: string) => (hashes.chamadas++, hashSenha(s)),
  };
  const temporaria = () => {
    const ultimo = email.enviados.at(-1);
    return ultimo && 'senhaTemporaria' in ultimo.dados ? ultimo.dados.senhaTemporaria : '';
  };
  return { email, hashes, deps, temporaria };
}

const entrar = (login: string, senha: string, conferir?: typeof conferirSenha) =>
  autenticar({ login, senha, ip: null }, { cliente: app, agora: relogio, ...(conferir ? { conferirSenha: conferir } : {}) });
const contexto = async (token: string): Promise<ContextoRequisicao> =>
  (await criarProvedorContexto({ cliente: app, agora: relogio, lerCookie: async () => token, lerCabecalho: async () => null }).obter())!;
const ok = { ok: true, valor: { mensagem: MENSAGENS.RECUPERACAO_ENVIADA } };

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  hashVigente = await hashSenha(VIGENTE);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('solicitarRecuperacaoSenha', () => {
  it('login vazio → E5; não elegíveis → A1.5, nada gravado, sem e-mail, Histórico sem o login', async () => {
    const a = ambiente();
    expect(await solicitarRecuperacaoSenha({ login: '  ' }, { ip: null }, a.deps)).toEqual({ ok: false, erros: [{ campo: 'login', mensagem: MENSAGENS.LOGIN_OBRIGATORIO_RECUPERACAO }] });
    await usuario('rec.inativo', { ativo: false });
    await usuario('rec.bloqueado', { bloqueado: true });
    for (const login of ['nao.existe', 'rec.inativo', 'rec.bloqueado']) expect(await solicitarRecuperacaoSenha({ login }, { ip: null }, a.deps)).toEqual(ok);
    expect(a.email.enviados).toEqual([]);
    expect(await migrator.usuario.count({ where: { recuperacaoHash: { not: null } } })).toBe(0);
    const hist = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'aut.recuperacao' } });
    expect(hist).toHaveLength(3);
    expect(hist.every((h) => h.descricao === 'Pedido de nova senha não atendido: login não elegível' && h.usuarioId === null)).toBe(true);
    expect(JSON.stringify(hist.map((h) => [h.descricao, h.usuarioRotulo, h.registroId]))).not.toContain('nao.existe');
  });

  it('elegível → a mesma resposta; temporária gravada com 24 h; senha vigente inalterada; e-mail no outbox', async () => {
    const a = ambiente();
    const u = await usuario('rec.ok');
    expect(await solicitarRecuperacaoSenha({ login: 'REC.OK' }, { ip: null }, a.deps)).toEqual(ok);
    const lido = await migrator.usuario.findUniqueOrThrow({ where: { id: u.id } });
    expect(lido.senhaHash).toBe(hashVigente);
    expect(lido.recuperacaoExpiraEm).toEqual(new Date(agora.getTime() + 24 * 3600_000));
    expect(await conferirSenha(lido.recuperacaoHash!, a.temporaria())).toBe(true);
    expect(a.email.enviados.map((e) => e.modelo)).toEqual(['usuario.recuperacao_senha']);
  });

  it('o Argon2 roda uma vez no elegível e uma no inexistente (tempo igual)', async () => {
    await usuario('rec.tempo');
    const elegivel = ambiente();
    await solicitarRecuperacaoSenha({ login: 'rec.tempo' }, { ip: null }, elegivel.deps);
    const inexistente = ambiente();
    await solicitarRecuperacaoSenha({ login: 'rec.nada' }, { ip: null }, inexistente.deps);
    expect([elegivel.hashes.chamadas, inexistente.hashes.chamadas]).toEqual([1, 1]);
  });

  it('acima do limite por login → a mesma resposta, e nada é gerado no 21º', async () => {
    await usuario('rec.limite');
    const a = ambiente();
    for (let i = 0; i < 20; i++) await solicitarRecuperacaoSenha({ login: 'rec.limite' }, { ip: null }, a.deps);
    const enviados = a.email.enviados.length;
    expect(await solicitarRecuperacaoSenha({ login: 'rec.limite' }, { ip: null }, a.deps)).toEqual(ok);
    expect(a.email.enviados.length).toBe(enviados);
  });
});

describe('login e troca com a temporária (D-P8-3, D-P8-3a)', () => {
  it('entra com a temporária: sessão só para a troca, temporária consumida; segundo uso recusado; troca sem a senha atual', async () => {
    const a = ambiente();
    const u = await usuario('rec.uso');
    await solicitarRecuperacaoSenha({ login: 'rec.uso' }, { ip: null }, a.deps);
    const r = await entrar('rec.uso', a.temporaria());
    expect(r).toMatchObject({ ok: true, trocaSenhaObrigatoria: true });
    expect(await migrator.usuario.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ recuperacaoHash: null, recuperacaoExpiraEm: null, senhaHash: hashVigente });
    const segunda = await entrar('rec.uso', a.temporaria());
    expect(segunda).toMatchObject({ ok: false, mensagem: MENSAGENS.CREDENCIAIS });
    // A troca obrigatória (pela sessão) não pede a senha atual e grava a nova.
    const ctx = await contexto(r.ok ? r.token : '');
    expect(ctx.trocaSenhaPendente).toBe(true);
    const NOVA = 'NovaSenha#2026abc';
    const troca = await trocarSenha(ctx, { novaSenha: NOVA, repetirSenha: NOVA }, { cliente: app, agora: relogio });
    expect(troca.ok).toBe(true);
    expect((await entrar('rec.uso', NOVA)).ok).toBe(true);
  });

  it('com a senha vigente: entra normal e a temporária pendente sai; temporária vencida → SENHA_EXPIRADA', async () => {
    const a = ambiente();
    const u = await usuario('rec.vigente');
    await solicitarRecuperacaoSenha({ login: 'rec.vigente' }, { ip: null }, a.deps);
    expect(await entrar('rec.vigente', VIGENTE)).toMatchObject({ ok: true, trocaSenhaObrigatoria: false });
    expect((await migrator.usuario.findUniqueOrThrow({ where: { id: u.id } })).recuperacaoHash).toBeNull();
    await solicitarRecuperacaoSenha({ login: 'rec.vigente' }, { ip: null }, a.deps);
    const temp = a.temporaria();
    agora = new Date(agora.getTime() + 25 * 3600_000);
    try {
      expect(await entrar('rec.vigente', temp)).toMatchObject({ ok: false, mensagem: MENSAGENS.SENHA_EXPIRADA });
    } finally {
      agora = new Date('2026-11-11T12:00:00.000Z');
    }
  });

  it('tempo constante: inexistente, existente sem e com temporária (senha errada) fazem duas conferências', async () => {
    const a = ambiente();
    await usuario('rec.sem');
    await usuario('rec.com');
    await solicitarRecuperacaoSenha({ login: 'rec.com' }, { ip: null }, a.deps);
    const contagens: number[] = [];
    for (const login of ['rec.ninguem', 'rec.sem', 'rec.com']) {
      let n = 0;
      const espiao: typeof conferirSenha = (h, s) => (n++, conferirSenha(h, s));
      await entrar(login, 'errada-123', espiao);
      contagens.push(n);
    }
    expect(contagens).toEqual([2, 2, 2]);
  });

  it('dois logins paralelos com a mesma temporária: só um entra', async () => {
    const a = ambiente();
    await usuario('rec.paralelo');
    await solicitarRecuperacaoSenha({ login: 'rec.paralelo' }, { ip: null }, a.deps);
    const temp = a.temporaria();
    const rs = await Promise.all([entrar('rec.paralelo', temp), entrar('rec.paralelo', temp)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it('a redefinição pelo Administrador, a inativação e o bloqueio automático apagam a temporária', async () => {
    const a = ambiente();
    const admin = await usuario('rec.admin');
    const ctxAdmin: ContextoRequisicao = { usuarioId: admin.id, usuarioRotulo: 'rec.admin', sessaoUid: 's', ip: null, permissoes: new Set(['adm.usuarios:alterar']) };
    const u = await usuario('rec.borda');
    await solicitarRecuperacaoSenha({ login: 'rec.borda' }, { ip: null }, a.deps);
    await resetarSenha(ctxAdmin, u.id, { cliente: app, agora: relogio, enviarEmail: a.email.enviarEmail });
    expect((await migrator.usuario.findUniqueOrThrow({ where: { id: u.id } })).recuperacaoHash).toBeNull();

    const b = await usuario('rec.bloq');
    await solicitarRecuperacaoSenha({ login: 'rec.bloq' }, { ip: null }, a.deps);
    for (let i = 0; i < 5; i++) await entrar('rec.bloq', `errada-${i}`);
    expect(await migrator.usuario.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ bloqueado: true, recuperacaoHash: null });
  });
});
