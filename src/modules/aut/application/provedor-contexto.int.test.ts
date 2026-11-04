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
    expect(await migrator.sessaoUsuario.count({ where: { usuarioId: u.id } })).toBe(0);
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
    try {
      const ctx = await provedor().obter();
      expect([...(ctx?.permissoes ?? [])].some((p) => p.startsWith('adm.usuarios:'))).toBe(false);
    } finally {
      await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: true } });
    }
  });
});

describe('sessão encerrada por novo acesso (US-028, RN0519)', () => {
  it('o segundo login grava a marca da sessão anterior, com o prazo dela; motivoAusencia devolve NOVO_ACESSO', async () => {
    await criarUsuario('estacao1');
    const antigo = await logar('estacao1');
    const sessaoAntiga = await migrator.sessaoUsuario.findFirstOrThrow({ where: { usuario: { login: 'estacao1' } } });
    agora = new Date(agora.getTime() + 60_000);
    await logar('estacao1');
    const marca = await migrator.sessaoEncerrada.findUniqueOrThrow({ where: { tokenHash: sessaoAntiga.tokenHash } });
    expect(marca).toMatchObject({ motivo: 'NOVO_ACESSO', expiraEm: sessaoAntiga.expiraEm });
    cookie = antigo;
    expect(await provedor().obter()).toBeNull();
    // A leitura não apaga a marca: o layout e a página leem na mesma requisição.
    expect(await provedor().motivoAusencia!()).toBe('NOVO_ACESSO');
    expect(await provedor().motivoAusencia!()).toBe('NOVO_ACESSO');
  });

  it('sem cookie, token desconhecido ou marca vencida → null; um login depois do prazo apaga as marcas vencidas', async () => {
    await criarUsuario('estacao2');
    const antigo = await logar('estacao2');
    await logar('estacao2');
    expect(await provedor().motivoAusencia!()).toBeNull();
    cookie = 'desconhecido';
    expect(await provedor().motivoAusencia!()).toBeNull();
    cookie = antigo;
    agora = new Date(agora.getTime() + 13 * 60 * 60 * 1000); // passa do teto de 12 h da sessão encerrada
    expect(await provedor().motivoAusencia!()).toBeNull();
    await logar('estacao2');
    const u = await migrator.usuario.findFirstOrThrow({ where: { login: 'estacao2' } });
    // A marca antiga venceu e saiu; a sessão do login anterior também já tinha vencido (teto de 12 h),
    // então este login não marca nada.
    expect(await migrator.sessaoEncerrada.count({ where: { usuarioId: u.id } })).toBe(0);
  });

  it('sessão já parada por inatividade não recebe a marca: a estação vê "Sessão expirada"', async () => {
    await criarUsuario('estacao4');
    await logar('estacao4');
    agora = new Date(agora.getTime() + 31 * 60 * 1000);
    await logar('estacao4');
    const u = await migrator.usuario.findFirstOrThrow({ where: { login: 'estacao4' } });
    expect(await migrator.sessaoEncerrada.count({ where: { usuarioId: u.id } })).toBe(0);
  });

  it('sequência A, B, C: o aviso de A continua valendo depois do login de C', async () => {
    await criarUsuario('estacao5');
    const a = await logar('estacao5');
    agora = new Date(agora.getTime() + 60_000);
    await logar('estacao5');
    agora = new Date(agora.getTime() + 60_000);
    await logar('estacao5');
    cookie = a;
    expect(await provedor().motivoAusencia!()).toBe('NOVO_ACESSO');
  });

  it('a troca de senha rotaciona o token sem marca de novo acesso', async () => {
    await criarUsuario('estacao3');
    await logar('estacao3');
    const u = await migrator.usuario.findFirstOrThrow({ where: { login: 'estacao3' } });
    const { emitirSessao } = await import('./sessao');
    await app.$transaction((tx) => emitirSessao(tx, { usuarioId: u.id, acessoVersao: u.acessoVersao, trocaSenhaPendente: false, ip: null, agora, maximoHoras: 12, inatividadeMin: 30, motivoAnteriores: null }));
    expect(await migrator.sessaoEncerrada.count({ where: { usuarioId: u.id } })).toBe(0);
  });
});
