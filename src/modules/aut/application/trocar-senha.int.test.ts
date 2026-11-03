import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { conferirSenha, hashSenha, seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';
import { criarLimitadorLogin, type LimitadorLogin } from './limite-login';
import { criarProvedorContexto } from './provedor-contexto';
import { trocarSenha } from './trocar-senha';

// Troca de senha (US-030, UC02.19, REQ0039, D-P5-3).
let falharAuditoria = false;
vi.mock('@/shared/audit', async (original) => {
  const m = await original<typeof import('@/shared/audit')>();
  return {
    ...m,
    auditar: async (...args: Parameters<typeof m.auditar>) => {
      if (falharAuditoria) throw new Error('falha simulada da auditoria');
      return m.auditar(...args);
    },
  };
});

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
const ATUAL = `Atual${Date.now()}x`;
const NOVA = `Nova${Date.now()}yz`;
const relogio = () => AGORA;

type Logado = { ctx: ContextoRequisicao; token: string };

async function logado(login: string, obrigatoria: boolean): Promise<Logado> {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'ORCAMENTISTA' } });
  await migrator.usuario.create({
    data: {
      nome: login,
      email: `${login}@exemplo.org`,
      login,
      loginNormalizado: login,
      senhaHash: await hashSenha(ATUAL),
      trocaSenhaObrigatoria: obrigatoria,
      perfis: { create: { perfilId: p.id } },
    },
  });
  const r = await autenticar({ login, senha: ATUAL, ip: null }, { cliente: app, agora: relogio });
  if (!r.ok) throw new Error(`login falhou: ${r.motivo}`);
  return { ctx: await contexto(r.token), token: r.token };
}

async function contexto(token: string): Promise<ContextoRequisicao> {
  const c = await criarProvedorContexto({ cliente: app, agora: relogio, lerCookie: async () => token, lerCabecalho: async () => null }).obter();
  if (!c) throw new Error('sem contexto');
  return c;
}

const provedorCom = (token: string) =>
  criarProvedorContexto({ cliente: app, agora: relogio, lerCookie: async () => token, lerCabecalho: async () => null }).obter();
const trocar = (ctx: ContextoRequisicao, e: { senhaAtual?: string; novaSenha: string; repetirSenha: string }, limitador?: LimitadorLogin) =>
  trocarSenha(ctx, e, { cliente: app, agora: relogio, ...(limitador ? { limitador } : {}) });

// Limitador real com espiões: prova a vaga reservada (senha atual errada) e devolvida (o resto).
function limitadorEspiao() {
  const real = criarLimitadorLogin();
  const chamadas = { permitir: 0, liberar: 0, executar: 0 };
  const l: LimitadorLogin = {
    permitir: (ip, login) => (chamadas.permitir++, real.permitir(ip, login)),
    liberar: (ip) => (chamadas.liberar++, real.liberar(ip)),
    executar: (f) => (chamadas.executar++, real.executar(f)),
    tamanho: () => real.tamanho(),
  };
  return { l, chamadas };
}
const usuario = (login: string) => migrator.usuario.findUniqueOrThrow({ where: { loginNormalizado: login } });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(() => {
  falharAuditoria = false;
});

describe('trocarSenha: validação', () => {
  it('senhas diferentes → repetirSenha (RN0038)', async () => {
    const { ctx } = await logado('ana', true);
    expect(await trocar(ctx, { novaSenha: NOVA, repetirSenha: `${NOVA}z` })).toEqual({
      ok: false,
      erros: [{ campo: 'repetirSenha', mensagem: 'A nova senha e a confirmação devem ser iguais' }],
    });
  });

  it('fora da política → novaSenha (RN0039)', async () => {
    const { ctx } = await logado('bia', true);
    const r = await trocar(ctx, { novaSenha: 'curta1', repetirSenha: 'curta1' });
    expect(r).toMatchObject({ ok: false, erros: [{ campo: 'novaSenha', mensagem: 'A senha deve ter pelo menos 10 caracteres' }] });
  });

  it('igual à atual → novaSenha', async () => {
    const { ctx } = await logado('caio', true);
    expect(await trocar(ctx, { novaSenha: ATUAL, repetirSenha: ATUAL })).toEqual({
      ok: false,
      erros: [{ campo: 'novaSenha', mensagem: 'A nova senha deve ser diferente da atual' }],
    });
  });
});

describe('trocarSenha: senha atual (D-P5-3)', () => {
  it('voluntária sem senha atual, ou com ela errada → senhaAtual', async () => {
    const { ctx } = await logado('dani', false);
    const erro = { ok: false, erros: [{ campo: 'senhaAtual', mensagem: 'Senha atual incorreta' }] };
    expect(await trocar(ctx, { novaSenha: NOVA, repetirSenha: NOVA })).toEqual(erro);
    expect(await trocar(ctx, { senhaAtual: `${ATUAL}x`, novaSenha: NOVA, repetirSenha: NOVA })).toEqual(erro);
  });

  it('senha atual errada conta falha; no limite bloqueia e a sessão cai', async () => {
    const { ctx, token } = await logado('edu', false);
    const versao = (await usuario('edu')).acessoVersao;
    for (let i = 0; i < 5; i++) await trocar(ctx, { senhaAtual: `errada${i}x`, novaSenha: NOVA, repetirSenha: NOVA });
    expect(await usuario('edu')).toMatchObject({ bloqueado: true, tentativasFalhas: 5, acessoVersao: versao + 1 });
    expect(await provedorCom(token)).toBeNull();
    const h = await migrator.historicoOperacao.findMany({ where: { usuarioRotulo: 'edu', descricao: { contains: 'bloqueado após' } } });
    expect(h).toHaveLength(1);
  });

  it('voluntária com a senha atual certa: troca, passa pelo limitador e devolve a vaga', async () => {
    const { ctx } = await logado('vera', false);
    const { l, chamadas } = limitadorEspiao();
    expect(await trocar(ctx, { senhaAtual: ATUAL, novaSenha: NOVA, repetirSenha: NOVA }, l)).toMatchObject({ ok: true });
    expect(chamadas).toEqual({ permitir: 1, liberar: 1, executar: 1 });
  });

  it('senha atual errada: a vaga fica reservada; nova igual à atual: devolvida', async () => {
    const { ctx } = await logado('wal', false);
    const { l, chamadas } = limitadorEspiao();
    await trocar(ctx, { senhaAtual: 'erradaQualquer1', novaSenha: NOVA, repetirSenha: NOVA }, l);
    expect(chamadas.liberar).toBe(0);
    await trocar(ctx, { senhaAtual: ATUAL, novaSenha: ATUAL, repetirSenha: ATUAL }, l);
    expect(chamadas.liberar).toBe(1);
  });

  it('limitador ocupado: recusa sem rodar Argon2 e devolve a vaga', async () => {
    const { ctx } = await logado('xavi', false);
    const ocupado: LimitadorLogin = { ...criarLimitadorLogin(), executar: async () => 'OCUPADO' };
    let liberou = 0;
    const l = { ...ocupado, liberar: () => void liberou++ };
    expect(await trocar(ctx, { senhaAtual: ATUAL, novaSenha: NOVA, repetirSenha: NOVA }, l)).toMatchObject({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }],
    });
    expect(liberou).toBe(1);
  });

  it('senha alterada entre as fases → "alterado por outro usuário"', async () => {
    const { ctx } = await logado('yara', true);
    const { l } = limitadorEspiao();
    const corrida: LimitadorLogin = {
      ...l,
      executar: async (f) => {
        const r = await l.executar(f);
        await migrator.usuario.update({ where: { loginNormalizado: 'yara' }, data: { senhaHash: await hashSenha(`Outra${Date.now()}z`) } });
        return r;
      },
    };
    expect(await trocar(ctx, { novaSenha: NOVA, repetirSenha: NOVA }, corrida)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
  });

  it('obrigatória não pede a senha atual', async () => {
    const { ctx } = await logado('fabi', true);
    expect(await trocar(ctx, { novaSenha: NOVA, repetirSenha: NOVA })).toMatchObject({ ok: true });
  });
});

describe('trocarSenha: sucesso', () => {
  it('grava o hash, tira a obrigatoriedade, rotaciona o token e audita sem hash', async () => {
    const { ctx, token } = await logado('gil', true);
    const versaoAntes = (await usuario('gil')).versao;
    const r = await trocar(ctx, { novaSenha: NOVA, repetirSenha: NOVA });
    if (!r.ok) throw new Error('esperava sucesso');
    const u = await usuario('gil');
    expect(await conferirSenha(u.senhaHash, NOVA)).toBe(true);
    expect(u).toMatchObject({ trocaSenhaObrigatoria: false, senhaExpiraEm: null });
    // A versão do cadastro não muda: o formulário aberto do Administrador continua valendo.
    expect(u.versao).toBe(versaoAntes);
    // Token velho não vale; o novo tem as permissões completas.
    expect(await provedorCom(token)).toBeNull();
    const novo = await provedorCom(r.valor.token);
    expect(novo?.trocaSenhaPendente).toBe(false);
    expect(novo?.permissoes.has('aut.tela_principal:consultar')).toBe(true);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { usuarioId: u.id, funcionalidade: 'aut.senha', tipoOperacao: 'ALTERACAO' } });
    expect(JSON.stringify(h, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).not.toMatch(/argon2|\$argon/);
  });

  it('senha temporária não vale depois da troca', async () => {
    expect(await autenticar({ login: 'gil', senha: ATUAL, ip: null }, { cliente: app, agora: relogio })).toMatchObject({
      ok: false,
      motivo: 'CREDENCIAIS',
    });
  });

  it('falha na auditoria: senha e sessão ficam como estavam (§10.2, item 1)', async () => {
    const { ctx, token } = await logado('hugo', true);
    const antes = await usuario('hugo');
    falharAuditoria = true;
    await expect(trocar(ctx, { novaSenha: NOVA, repetirSenha: NOVA })).rejects.toThrow('falha simulada');
    falharAuditoria = false;
    expect((await usuario('hugo')).senhaHash).toBe(antes.senhaHash);
    expect(await provedorCom(token)).not.toBeNull();
  });
});
