import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSenha, seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';

// Autenticação (US-026, UC01.02): ordem das verificações, contador, bloqueio, sessão e Histórico.
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
const IP = '203.0.113.9';
// Senhas geradas em tempo de execução (GitGuardian acusa literais).
const SENHA = `Certa${Date.now()}x`;
const ERRADA = `Errada${Date.now()}y`;
let hash: string;

const entrar = (login: string, senha = SENHA, ip: string | null = IP) =>
  autenticar({ login, senha, ip }, { cliente: app, agora: () => AGORA });

async function criarUsuario(login: string, extra: Record<string, unknown> = {}, perfil = 'ORCAMENTISTA') {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: perfil } });
  return migrator.usuario.create({
    data: {
      nome: login,
      email: `${login}@exemplo.org`,
      login,
      loginNormalizado: login.toLowerCase(),
      senhaHash: hash,
      trocaSenhaObrigatoria: false,
      perfis: { create: { perfilId: p.id } },
      ...extra,
    },
  });
}

const usuario = (login: string) => migrator.usuario.findUniqueOrThrow({ where: { loginNormalizado: login } });
const historico = (filtro: Record<string, unknown>) => migrator.historicoOperacao.findMany({ where: filtro, orderBy: { id: 'asc' } });
const sessoes = (usuarioId: string) => migrator.sessaoUsuario.findMany({ where: { usuarioId } });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  hash = await hashSenha(SENHA);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(async () => {
  falharAuditoria = false;
  await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: false } });
});

describe('autenticar: entrada e credenciais', () => {
  it('login com caixa e espaços; senha diferencia caixa', async () => {
    await criarUsuario('ana');
    expect(await entrar(' ANA ')).toMatchObject({ ok: true, trocaSenhaObrigatoria: false });
    expect(await entrar('ana', SENHA.toUpperCase())).toMatchObject({ ok: false, motivo: 'CREDENCIAIS', mensagem: 'Login ou senha inválidos' });
  });

  it('senha só com espaços: ENTRADA, sem contador e sem Histórico (RN0014)', async () => {
    const antes = await migrator.historicoOperacao.count();
    const u0 = await usuario('ana');
    expect(await entrar('ana', '   ')).toMatchObject({ ok: false, motivo: 'ENTRADA', mensagem: 'Login e/ou Senha são obrigatórios' });
    expect((await usuario('ana')).tentativasFalhas).toBe(u0.tentativasFalhas);
    expect(await migrator.historicoOperacao.count()).toBe(antes);
  });

  it('inexistente: CREDENCIAIS, Histórico LOGIN com usuário nulo e o login normalizado', async () => {
    expect(await entrar('Ninguem')).toMatchObject({ ok: false, motivo: 'CREDENCIAIS' });
    const [h] = await historico({ usuarioRotulo: 'ninguem' });
    expect(h).toMatchObject({ tipoOperacao: 'LOGIN', usuarioId: null, funcionalidade: 'aut.login' });
  });

  it('login inválido não vai ao Histórico (rótulo "[inválido]")', async () => {
    expect(await entrar('Senh@Secreta 1')).toMatchObject({ ok: false, motivo: 'CREDENCIAIS' });
    expect(await historico({ usuarioRotulo: { contains: 'Senh' } })).toEqual([]);
    expect((await historico({ usuarioRotulo: '[inválido]' })).length).toBe(1);
  });

  it('inativo: CREDENCIAIS, Histórico e contador igual', async () => {
    const u = await criarUsuario('inativo', { ativo: false });
    expect(await entrar('inativo')).toMatchObject({ ok: false, motivo: 'CREDENCIAIS' });
    expect((await usuario('inativo')).tentativasFalhas).toBe(0);
    expect((await historico({ usuarioId: u.id })).length).toBe(1);
  });
});

describe('autenticar: bloqueio', () => {
  it('bloqueado: BLOQUEADO mesmo com a senha certa, com Histórico e sem mexer no contador', async () => {
    const u = await criarUsuario('bloq', { bloqueado: true, tentativasFalhas: 5 });
    expect(await entrar('bloq')).toMatchObject({
      ok: false,
      motivo: 'BLOQUEADO',
      mensagem: 'Usuário bloqueado. Contate o Administrador do sistema.',
    });
    expect((await usuario('bloq')).tentativasFalhas).toBe(5);
    expect((await historico({ usuarioId: u.id })).length).toBe(1);
  });

  it('4 erradas avisam a última tentativa; a 5ª bloqueia com "5 tentativas" no Histórico', async () => {
    const u = await criarUsuario('carla');
    for (let i = 1; i <= 3; i++) expect(await entrar('carla', ERRADA)).toMatchObject({ avisoUltimaTentativa: false });
    expect(await entrar('carla', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS', avisoUltimaTentativa: true });
    expect(await entrar('carla', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS', avisoUltimaTentativa: false });
    expect(await usuario('carla')).toMatchObject({ bloqueado: true, tentativasFalhas: 5 });
    expect((await historico({ usuarioId: u.id, descricao: { contains: '5 tentativas' } })).length).toBe(1);
  });

  it('tentativas simultâneas no limite: um bloqueio só', async () => {
    const u = await criarUsuario('davi', { tentativasFalhas: 4 });
    const r = await Promise.all([entrar('davi', ERRADA), entrar('davi', ERRADA)]);
    expect(r.map((x) => (x.ok ? 'ok' : x.motivo)).sort()).toEqual(['BLOQUEADO', 'CREDENCIAIS']);
    expect(await usuario('davi')).toMatchObject({ bloqueado: true, tentativasFalhas: 5 });
    expect((await historico({ usuarioId: u.id, descricao: { contains: 'bloqueado após' } })).length).toBe(1);
  });
});

describe('autenticar: manutenção (RN0023)', () => {
  beforeEach(() => migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: true } }));

  it('não administrador: MANUTENCAO, com Histórico e sem contador', async () => {
    const u = await criarUsuario('eva');
    expect(await entrar('eva', ERRADA)).toMatchObject({ ok: false, motivo: 'MANUTENCAO', mensagem: 'Sistema está em manutenção' });
    expect((await usuario('eva')).tentativasFalhas).toBe(0);
    expect((await historico({ usuarioId: u.id })).length).toBe(1);
  });

  it('administrador com senha errada: CREDENCIAIS e contador +1; com a certa, entra', async () => {
    await criarUsuario('chefe', {}, 'ADMINISTRADOR');
    expect(await entrar('chefe', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS' });
    expect((await usuario('chefe')).tentativasFalhas).toBe(1);
    expect(await entrar('chefe')).toMatchObject({ ok: true });
  });
});

describe('autenticar: sessão', () => {
  it('sucesso: sessão com uid, teto de 12 h e acessoVersao; contador zerado; Histórico LOGIN', async () => {
    const u = await criarUsuario('fabio', { tentativasFalhas: 2, acessoVersao: 3 });
    const r = await entrar('fabio');
    expect(r).toMatchObject({ ok: true });
    const [s] = await sessoes(u.id);
    expect(s).toMatchObject({ ip: IP, acessoVersao: 3, trocaSenhaPendente: false });
    expect(s?.expiraEm.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(atob(s?.sessaoUid ?? '')).toBe(`${AGORA.toISOString()}|${IP}|${u.id}`);
    expect((await usuario('fabio')).tentativasFalhas).toBe(0);
    const [h] = await historico({ usuarioId: u.id, tipoOperacao: 'LOGIN' });
    expect(h).toMatchObject({ sessaoUid: s?.sessaoUid, ip: IP });
    // O token não é guardado em claro.
    expect(r.ok && s?.tokenHash).not.toBe(r.ok && r.token);
  });

  it('sessão única: o segundo login encerra a primeira, com Histórico (A2.3)', async () => {
    const u = await usuario('fabio');
    await entrar('fabio');
    expect(await sessoes(u.id)).toHaveLength(1);
    expect((await historico({ usuarioId: u.id, descricao: { contains: 'Sessão anterior encerrada' } })).length).toBeGreaterThan(0);
  });

  it('troca obrigatória: sessão marcada e resultado sinaliza', async () => {
    const u = await criarUsuario('gil', { trocaSenhaObrigatoria: true });
    expect(await entrar('gil')).toMatchObject({ ok: true, trocaSenhaObrigatoria: true });
    expect((await sessoes(u.id))[0]?.trocaSenhaPendente).toBe(true);
  });

  it('falha na transação: FALHA_SESSAO, sem sessão e contador igual (RNF0013)', async () => {
    const u = await criarUsuario('hugo', { tentativasFalhas: 2 });
    falharAuditoria = true;
    expect(await entrar('hugo')).toMatchObject({
      ok: false,
      motivo: 'FALHA_SESSAO',
      mensagem: 'Não foi possível iniciar sua sessão. Tente novamente.',
    });
    expect(await sessoes(u.id)).toEqual([]);
    expect((await usuario('hugo')).tentativasFalhas).toBe(2);
  });
});

describe('autenticar: senha temporária', () => {
  it('expirada com a senha certa: SENHA_EXPIRADA sem contar falha', async () => {
    await criarUsuario('ivo', { senhaExpiraEm: new Date('2026-11-10T00:00:00Z'), trocaSenhaObrigatoria: true });
    expect(await entrar('ivo')).toMatchObject({
      ok: false,
      motivo: 'SENHA_EXPIRADA',
      mensagem: 'Senha temporária expirada. Solicite uma nova senha ao Administrador.',
    });
    expect((await usuario('ivo')).tentativasFalhas).toBe(0);
  });

  it('expirada com a senha errada: CREDENCIAIS e conta a falha', async () => {
    expect(await entrar('ivo', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS' });
    expect((await usuario('ivo')).tentativasFalhas).toBe(1);
  });
});
