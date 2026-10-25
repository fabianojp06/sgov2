import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSenha, seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';
import { criarProvedorContexto, PERMISSOES_BASICAS, PERMISSOES_TROCA_OBRIGATORIA } from './provedor-contexto';

// Provedor de contexto (US-026 parte 2): cookie → sessão → usuário → permissões.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let agora = new Date('2026-11-11T12:00:00.000Z');
const SENHA = `Certa${Date.now()}x`;
let hash: string;
let cookie: string | undefined;

const relogio = () => agora;
const provedor = () =>
  criarProvedorContexto({
    cliente: app,
    agora: relogio,
    lerCookie: async () => cookie,
    lerCabecalho: async (nome) => (nome === 'x-sgo-ip' ? '203.0.113.9' : null),
  });

async function criarUsuario(login: string, extra: Record<string, unknown> = {}, perfil = 'ADMINISTRADOR') {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: perfil } });
  return migrator.usuario.create({
    data: {
      nome: login,
      email: `${login}@exemplo.org`,
      login,
      loginNormalizado: login,
      senhaHash: hash,
      trocaSenhaObrigatoria: false,
      perfis: { create: { perfilId: p.id } },
      ...extra,
    },
  });
}

async function logar(login: string): Promise<string> {
  const r = await autenticar({ login, senha: SENHA, ip: null }, { cliente: app, agora: relogio });
  if (!r.ok) throw new Error(`login falhou: ${r.motivo}`);
  return r.token;
}

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

beforeEach(() => {
  agora = new Date('2026-11-11T12:00:00.000Z');
  cookie = undefined;
});

describe('criarProvedorContexto', () => {
  it('id estável', () => expect(provedor().id).toBe('aut.sessao'));

  it('sem cookie ou com token desconhecido → null', async () => {
    expect(await provedor().obter()).toBeNull();
    cookie = 'desconhecido';
    expect(await provedor().obter()).toBeNull();
  });

  it('token válido → contexto com o login, o IP, as permissões do perfil e as básicas', async () => {
    const u = await criarUsuario('ana');
    cookie = await logar('ana');
    const ctx = await provedor().obter();
    expect(ctx).toMatchObject({ usuarioId: u.id, usuarioRotulo: 'ana', ip: '203.0.113.9', trocaSenhaPendente: false });
    for (const p of ['adm.usuarios:consultar', 'adm.usuarios:incluir', ...PERMISSOES_BASICAS]) expect(ctx?.permissoes.has(p)).toBe(true);
  });

  it('renova o último acesso no máximo uma vez por minuto', async () => {
    const u = await criarUsuario('bia');
    cookie = await logar('bia');
    const ultimo = async () => (await migrator.sessaoUsuario.findFirstOrThrow({ where: { usuarioId: u.id } })).ultimoAcessoEm.toISOString();
    agora = new Date('2026-11-11T12:00:30.000Z');
    await provedor().obter();
    expect(await ultimo()).toBe('2026-11-11T12:00:00.000Z');
    agora = new Date('2026-11-11T12:01:01.000Z');
    await provedor().obter();
    expect(await ultimo()).toBe('2026-11-11T12:01:01.000Z');
  });

  it('inatividade acima de 30 min → null e a sessão é apagada', async () => {
    const u = await criarUsuario('caio');
    cookie = await logar('caio');
    agora = new Date('2026-11-11T12:31:00.000Z');
    expect(await provedor().obter()).toBeNull();
    expect(await migrator.sessaoUsuario.count({ where: { usuarioId: u.id } })).toBe(0);
  });

  it('teto da sessão atingido → null', async () => {
    const u = await criarUsuario('dani');
    cookie = await logar('dani');
    await migrator.sessaoUsuario.updateMany({ where: { usuarioId: u.id }, data: { expiraEm: new Date('2026-11-11T11:59:00Z') } });
    expect(await provedor().obter()).toBeNull();
  });

  it.each([
    ['inativado', { ativo: false }],
    ['bloqueado', { bloqueado: true }],
    ['com acesso alterado', { acessoVersao: 7 }],
  ])('usuário %s → null, sessão apagada e um Histórico de desconexão, mesmo em paralelo', async (_caso, mudanca) => {
    const login = `e${Math.random().toString(36).slice(2, 8)}`;
    const u = await criarUsuario(login);
    cookie = await logar(login);
    await migrator.usuario.update({ where: { id: u.id }, data: mudanca });
    const [a, b] = await Promise.all([provedor().obter(), provedor().obter()]);
    expect([a, b]).toEqual([null, null]);
    expect(await migrator.sessaoUsuario.count({ where: { usuarioId: u.id } })).toBe(0);
    const h = await migrator.historicoOperacao.findMany({ where: { usuarioId: u.id, descricao: { contains: 'desconectado pelo sistema' } } });
    expect(h).toHaveLength(1);
  });

  it('troca de senha pendente → só as permissões da troca', async () => {
    await criarUsuario('fel', { trocaSenhaObrigatoria: true });
    cookie = await logar('fel');
    const ctx = await provedor().obter();
    expect(ctx?.trocaSenhaPendente).toBe(true);
    expect([...(ctx?.permissoes ?? [])].sort()).toEqual([...PERMISSOES_TROCA_OBRIGATORIA].sort());
  });

  it('funcionalidade desativada some das permissões', async () => {
    await criarUsuario('gui');
    cookie = await logar('gui');
    await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: false } });
    const ctx = await provedor().obter();
    expect([...(ctx?.permissoes ?? [])].some((p) => p.startsWith('adm.usuarios:'))).toBe(false);
    await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: true } });
  });
});
