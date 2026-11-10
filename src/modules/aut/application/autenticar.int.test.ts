import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSenha, seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar, hashDoToken } from './autenticar';

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

// Espião do conferirSenha (RNF0005: login inexistente também paga um Argon2).
const conferencias = vi.hoisted(() => ({ total: 0 }));
vi.mock('@/modules/adm', async (original) => {
  const m = await original<typeof import('@/modules/adm')>();
  return {
    ...m,
    conferirSenha: async (...args: Parameters<typeof m.conferirSenha>) => {
      conferencias.total++;
      return m.conferirSenha(...args);
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
  // Com a manutenção ligada sem instante, o login a fixa (US-036): desligar zera os campos da
  // desativação (CHECK da configuração).
  await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null } });
});

describe('autenticar: entrada e credenciais', () => {
  it('login com caixa e espaços; senha diferencia caixa', async () => {
    await criarUsuario('ana');
    expect(await entrar(' ANA ')).toMatchObject({ ok: true, trocaSenhaObrigatoria: false });
    expect(await entrar('ana', SENHA.toUpperCase())).toMatchObject({ ok: false, motivo: 'CREDENCIAIS', mensagem: 'Login ou senha inválidos' });
  });

  it('senha só com espaços: ENTRADA, sem contador e sem Histórico (RN0014)', async () => {
    await criarUsuario('ana2');
    const antes = await migrator.historicoOperacao.count();
    const u0 = await usuario('ana2');
    expect(await entrar('ana2', '   ')).toMatchObject({ ok: false, motivo: 'ENTRADA', mensagem: 'Login e/ou Senha são obrigatórios' });
    expect(await entrar('   ')).toMatchObject({ ok: false, motivo: 'ENTRADA', mensagem: 'Login e/ou Senha são obrigatórios' });
    expect((await usuario('ana2')).tentativasFalhas).toBe(u0.tentativasFalhas);
    expect(await migrator.historicoOperacao.count()).toBe(antes);
  });

  it('entrada longa (login > 60, senha > 128): ENTRADA genérica, sem banco e sem Histórico', async () => {
    const antes = await migrator.historicoOperacao.count();
    expect(await entrar('a'.repeat(61))).toMatchObject({ ok: false, motivo: 'ENTRADA', mensagem: 'Login ou senha inválidos' });
    expect(await entrar('ana2', `a1${'b'.repeat(127)}`)).toMatchObject({ ok: false, motivo: 'ENTRADA' });
    expect(await migrator.historicoOperacao.count()).toBe(antes);
  });

  it('entrada que não é texto: ENTRADA, sem exceção', async () => {
    expect(await autenticar({ login: 1 as unknown as string, senha: SENHA, ip: IP }, { cliente: app })).toMatchObject({
      ok: false,
      motivo: 'ENTRADA',
    });
  });

  it('IP inválido ou com zona IPv6 vira nulo, e a falha ainda conta (o inet recusaria)', async () => {
    await criarUsuario('ipzona');
    expect(await entrar('ipzona', ERRADA, 'fe80::1%eth0')).toMatchObject({ motivo: 'CREDENCIAIS' });
    expect((await usuario('ipzona')).tentativasFalhas).toBe(1);
  });

  it('inexistente: CREDENCIAIS, hash fictício, Histórico LOGIN com usuário nulo e o login normalizado', async () => {
    conferencias.total = 0;
    expect(await entrar('Ninguem')).toMatchObject({ ok: false, motivo: 'CREDENCIAIS', contaFalha: true });
    // Duas conferências em todo caminho que confere (vigente e temporária, ou o fictício duas vezes, D-P8-3a).
    expect(conferencias.total).toBe(2);
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
    expect(await usuario('carla')).toMatchObject({ bloqueado: true, tentativasFalhas: 5, acessoVersao: 1 });
    expect((await historico({ usuarioId: u.id, descricao: { contains: '5 tentativas' } })).length).toBe(1);
  });

  it('falha da transação numa senha errada desfaz o incremento e o bloqueio (UC01.05 E1.2)', async () => {
    await criarUsuario('jair', { tentativasFalhas: 4 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    falharAuditoria = true;
    expect(await entrar('jair', ERRADA)).toMatchObject({ motivo: 'FALHA_SESSAO' });
    expect(await usuario('jair')).toMatchObject({ tentativasFalhas: 4, bloqueado: false });
    expect(log).toHaveBeenCalledWith('[LOGIN_FALHA_SESSAO]', expect.objectContaining({ nome: 'Error' }));
    log.mockRestore();
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
  beforeEach(async () => {
    await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: true } });
  });

  it('não administrador: MANUTENCAO, com Histórico e sem contador; não conta por IP', async () => {
    const u = await criarUsuario('eva');
    expect(await entrar('eva', ERRADA)).toMatchObject({
      ok: false,
      motivo: 'MANUTENCAO',
      mensagem: 'Sistema está em manutenção',
      contaFalha: false,
    });
    expect((await usuario('eva')).tentativasFalhas).toBe(0);
    expect((await historico({ usuarioId: u.id })).length).toBe(1);
  });

  it('login inexistente em manutenção conta por IP', async () =>
    expect(await entrar('ninguem2')).toMatchObject({ motivo: 'MANUTENCAO', contaFalha: true }));

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
    // Token de 256 bits; o banco guarda só o SHA-256 dele (o provedor da 2b busca por esse hash).
    if (!r.ok) throw new Error('esperava sucesso');
    expect(Buffer.from(r.token, 'base64url')).toHaveLength(32);
    expect(s?.tokenHash).toBe(hashDoToken(r.token));
  });

  it('sessão única: o segundo login encerra a primeira, com um Histórico (A2.3)', async () => {
    const u = await criarUsuario('lia');
    await entrar('lia');
    const [primeira] = await sessoes(u.id);
    await entrar('lia');
    const atuais = await sessoes(u.id);
    expect(atuais).toHaveLength(1);
    expect(atuais[0]?.tokenHash).not.toBe(primeira?.tokenHash);
    expect(await historico({ usuarioId: u.id, descricao: { contains: 'Sessão anterior encerrada' } })).toHaveLength(1);
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
    expect(await historico({ usuarioRotulo: 'ivo', descricao: { contains: 'expirada' } })).toHaveLength(1);
  });

  it('expirada com a senha errada: CREDENCIAIS e conta a falha', async () => {
    expect(await entrar('ivo', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS' });
    expect((await usuario('ivo')).tentativasFalhas).toBe(1);
  });
});

// Alerta aos administradores por e-mail (US-027, REQ0040): no limiar e no bloqueio, um e-mail por
// administrador ativo, sem bloqueio, com e-mail e com o perfil ADMINISTRADOR ativo, pelo outbox,
// depois do commit. O e-mail nunca derruba nem muda o login.
describe('autenticar: alerta aos administradores (US-027)', () => {
  type Mensagem = { modelo: string; destinatario: { email: string; nome?: string }; dados: Record<string, unknown> };
  const alertasDe = async (login: string): Promise<Mensagem[]> =>
    (await migrator.outboxMensagem.findMany({ where: { tipo: 'email.enviar' }, orderBy: { criadoEm: 'asc' } }))
      .map((m) => m.dados as unknown as Mensagem)
      .filter((m) => m.modelo === 'usuario.alerta_tentativas' && m.dados.login === login);

  beforeAll(async () => {
    await criarUsuario('adm.alerta1', { nome: 'Ana Alerta' }, 'ADMINISTRADOR');
    await criarUsuario('adm.alerta2', { nome: 'Beto Alerta' }, 'ADMINISTRADOR');
    await criarUsuario('adm.inativo', { ativo: false }, 'ADMINISTRADOR');
    await criarUsuario('adm.bloqueado', { bloqueado: true }, 'ADMINISTRADOR');
    await criarUsuario('adm.semmail', { email: '' }, 'ADMINISTRADOR');
    await criarUsuario('orc.comum');
  });

  it('no limiar (3ª errada): um e-mail por administrador elegível, sem bloqueio', async () => {
    await criarUsuario('marta', { nome: 'Marta Lima', tentativasFalhas: 2 });
    expect(await entrar('marta', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS' });
    const alertas = await alertasDe('marta');
    const destinatarios = alertas.map((a) => a.destinatario.email);
    expect(destinatarios).toEqual(expect.arrayContaining(['adm.alerta1@exemplo.org', 'adm.alerta2@exemplo.org']));
    for (const fora of ['adm.inativo', 'adm.bloqueado', 'adm.semmail', 'orc.comum', 'marta']) {
      expect(destinatarios).not.toContain(`${fora}@exemplo.org`);
    }
    expect(new Set(destinatarios).size).toBe(destinatarios.length);
    expect(alertas.find((a) => a.destinatario.email === 'adm.alerta1@exemplo.org')).toMatchObject({
      destinatario: { nome: 'Ana Alerta' },
      dados: { nomeAdministrador: 'Ana Alerta', nomeUsuario: 'Marta Lima', login: 'marta', tentativas: 3, bloqueado: false, dataHora: '11/11/2026, 09:00' },
    });
    // A 4ª errada não é limiar nem bloqueio: nenhum e-mail novo.
    await entrar('marta', ERRADA);
    expect(await alertasDe('marta')).toHaveLength(alertas.length);
  });

  it('no bloqueio (5ª errada): e-mail com bloqueado = true e o log continua', async () => {
    await criarUsuario('nina', { tentativasFalhas: 4 });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await entrar('nina', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS' });
    expect(await usuario('nina')).toMatchObject({ bloqueado: true, tentativasFalhas: 5 });
    const alertas = await alertasDe('nina');
    expect(alertas.length).toBeGreaterThanOrEqual(2);
    expect(alertas.every((a) => a.dados.bloqueado === true && a.dados.tentativas === 5)).toBe(true);
    expect(log).toHaveBeenCalledWith('[LOGIN_TENTATIVAS]', { usuarioId: (await usuario('nina')).id, tentativas: 5, bloqueado: true });
    log.mockRestore();
  });

  it('falha do envio: o login responde igual, o contador e o bloqueio ficam, e o log não leva login nem e-mail', async () => {
    const otto = 'otto';
    await criarUsuario(otto, { tentativasFalhas: 4 });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await autenticar(
      { login: otto, senha: ERRADA, ip: IP },
      {
        cliente: app,
        agora: () => AGORA,
        enviarEmail: async () => {
          throw Object.assign(new Error('SMTP fora para otto e adm.alerta1@exemplo.org'), { code: 'X1' });
        },
      },
    );
    expect(r).toMatchObject({ ok: false, motivo: 'CREDENCIAIS', contaFalha: true });
    expect(await usuario('otto')).toMatchObject({ bloqueado: true, tentativasFalhas: 5 });
    expect(await alertasDe('otto')).toEqual([]);
    expect(erro).toHaveBeenCalledWith('[LOGIN_ALERTA_EMAIL_FALHA]', expect.objectContaining({ nome: 'Error', codigo: 'X1' }));
    expect(JSON.stringify(erro.mock.calls)).not.toMatch(/otto|@exemplo\.org/);
    erro.mockRestore();
  });

  it('nenhum administrador elegível (perfil ADMINISTRADOR inativo): sem e-mail, com aviso no log, e o login segue', async () => {
    await criarUsuario('paula', { tentativasFalhas: 2 });
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await migrator.perfil.update({ where: { codigo: 'ADMINISTRADOR' }, data: { ativo: false } });
    try {
      expect(await entrar('paula', ERRADA)).toMatchObject({ motivo: 'CREDENCIAIS' });
    } finally {
      await migrator.perfil.update({ where: { codigo: 'ADMINISTRADOR' }, data: { ativo: true } });
    }
    expect((await usuario('paula')).tentativasFalhas).toBe(3);
    expect(await alertasDe('paula')).toEqual([]);
    expect(aviso).toHaveBeenCalledWith('[LOGIN_ALERTA_SEM_DESTINATARIO]', { usuarioId: (await usuario('paula')).id });
    aviso.mockRestore();
  });

  it('senha certa e falhas abaixo do limiar não geram alerta', async () => {
    await criarUsuario('quito', { tentativasFalhas: 3 });
    expect(await entrar('quito')).toMatchObject({ ok: true });
    await criarUsuario('rita');
    await entrar('rita', ERRADA);
    expect([...(await alertasDe('quito')), ...(await alertasDe('rita'))]).toEqual([]);
  });
});
