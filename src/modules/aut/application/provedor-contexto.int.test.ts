import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSenha, obterConfiguracaoAcesso, seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';
import { obterAvisoDesativacao } from './aviso-desativacao';
import { efetivarDesativacao } from './efetivar-desativacao';
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

// Desativação do sistema (US-036, US-033; plano do P9, Task 2, D-P9-2 a D-P9-5): contagem pelo
// instante gravado, efetivação na primeira requisição, idempotente, quem desativou fica e todo
// Administrador fica só com a Administração; a consulta do aviso não renova a sessão.
describe('sistema desativado (US-036, US-033)', () => {
  const PRAZO = new Date('2026-11-11T12:05:00.000Z');
  let semRenovacao = false;
  const provedorAviso = () =>
    criarProvedorContexto({
      cliente: app,
      agora: relogio,
      lerCookie: async () => cookie,
      lerCabecalho: async (nome) => (nome === 'x-sgo-sem-renovacao' && semRenovacao ? '1' : null),
    });
  const desativar = (por: string | null, aPartir: Date | null = PRAZO) =>
    migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: true, manutencaoAPartir: aPartir, manutencaoMotivo: por ? 'Teste' : null, manutencaoPorId: por } });
  const desconexoes = () => migrator.historicoOperacao.count({ where: { descricao: { contains: 'desconectado pelo sistema' } } });
  const sessoesDe = (usuarioId: string) => migrator.sessaoUsuario.count({ where: { usuarioId } });

  beforeAll(async () => {
    // Uma funcionalidade fora da Administração com permissão do Administrador, para a restrição (RN0060).
    await migrator.funcionalidade.create({
      data: { codigo: 'orc.teste_sistema', moduloCodigo: 'ORCAMENTARIO', grupo: 'Teste', nome: 'Teste', rota: '/orc/teste-sistema', ordem: 99, acoes: ['consultar'] },
    });
    const adm = await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'ADMINISTRADOR' } });
    await migrator.perfilPermissao.create({ data: { perfilId: adm.id, funcionalidadeCodigo: 'orc.teste_sistema', acao: 'consultar' } });
  });

  beforeEach(async () => {
    semRenovacao = false;
    await migrator.sessaoUsuario.deleteMany();
  });

  afterEach(async () => {
    await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null } });
  });

  it('antes do prazo: contexto normal; depois: a primeira requisição desconecta todos menos quem desativou, de uma vez e uma vez só', async () => {
    const autor = await criarUsuario('sis.autor');
    const outroAdm = await criarUsuario('sis.adm2');
    const orc = await criarUsuario('sis.orc', {}, 'ORCAMENTISTA');
    const tokens = { autor: await logar('sis.autor'), outroAdm: await logar('sis.adm2'), orc: await logar('sis.orc') };
    await desativar(autor.id);
    const antes = await desconexoes();

    agora = new Date('2026-11-11T12:04:00.000Z');
    cookie = tokens.orc;
    expect((await provedor().obter())?.usuarioId).toBe(orc.id);
    expect(await desconexoes()).toBe(antes);

    agora = PRAZO;
    cookie = tokens.outroAdm;
    expect(await provedor().obter()).toBeNull();
    expect(await provedor().motivoAusencia!()).toBe('SISTEMA_INATIVO');
    expect([await sessoesDe(autor.id), await sessoesDe(outroAdm.id), await sessoesDe(orc.id)]).toEqual([1, 0, 0]);
    const h = await migrator.historicoOperacao.findMany({ where: { descricao: { contains: 'desconectado pelo sistema' } }, orderBy: { id: 'asc' }, skip: antes });
    expect(h.map((x) => x.descricao).sort()).toEqual(['Usuário sis.adm2 desconectado pelo sistema', 'Usuário sis.orc desconectado pelo sistema']);
    const marcas = await migrator.sessaoEncerrada.findMany({ where: { usuarioId: { in: [outroAdm.id, orc.id] } } });
    expect(marcas.map((m) => m.motivo)).toEqual(['SISTEMA_INATIVO', 'SISTEMA_INATIVO']);

    cookie = tokens.orc;
    expect(await provedor().obter()).toBeNull();
    expect(await provedor().motivoAusencia!()).toBe('SISTEMA_INATIVO');

    // Quem desativou continua, só com a Administração e as básicas (RN0060); nada novo no Histórico.
    cookie = tokens.autor;
    const ctx = await provedor().obter();
    expect(ctx?.usuarioId).toBe(autor.id);
    const permissoes = [...(ctx?.permissoes ?? [])];
    expect(permissoes).toContain('adm.sistema:alterar');
    expect(permissoes).not.toContain('orc.teste_sistema:consultar');
    expect(permissoes.every((p) => p.startsWith('adm.') || PERMISSOES_BASICAS.includes(p))).toBe(true);
    expect(await desconexoes()).toBe(antes + 2);
  });

  it('em paralelo, as requisições depois do prazo geram um Histórico por sessão', async () => {
    const autor = await criarUsuario('sis.par.autor');
    await criarUsuario('sis.par.a', {}, 'ORCAMENTISTA');
    await criarUsuario('sis.par.b', {}, 'ORCAMENTISTA');
    const a = await logar('sis.par.a');
    const b = await logar('sis.par.b');
    await desativar(autor.id);
    const antes = await desconexoes();
    agora = PRAZO;
    const obterCom = (token: string) =>
      criarProvedorContexto({ cliente: app, agora: relogio, lerCookie: async () => token, lerCabecalho: async () => null }).obter();
    expect(await Promise.all([obterCom(a), obterCom(b), obterCom(a)])).toEqual([null, null, null]);
    expect(await desconexoes()).toBe(antes + 2);
  });

  it('o Administrador que entra de novo com o sistema inativo fica, restrito à Administração', async () => {
    const autor = await criarUsuario('sis.volta.autor');
    await criarUsuario('sis.volta');
    await logar('sis.volta');
    await desativar(autor.id);
    agora = new Date('2026-11-11T12:06:00.000Z');
    cookie = await logar('sis.volta');
    const ctx = await provedor().obter();
    expect(ctx?.usuarioRotulo).toBe('sis.volta');
    expect(ctx?.permissoes.has('orc.teste_sistema:consultar')).toBe(false);
    expect(ctx?.permissoes.has('adm.usuarios:consultar')).toBe(true);
    agora = new Date('2026-11-11T12:07:00.000Z');
    expect((await provedor().obter())?.usuarioRotulo).toBe('sis.volta');
  });

  it('com o sistema ativo, o Administrador tem as permissões fora da Administração', async () => {
    await criarUsuario('sis.ativo');
    cookie = await logar('sis.ativo');
    expect((await provedor().obter())?.permissoes.has('orc.teste_sistema:consultar')).toBe(true);
  });

  it('manutenção ligada direto no banco (sem instante): derruba na hora, fixa o instante e não derruba quem entra depois', async () => {
    await criarUsuario('sis.banco.adm');
    await criarUsuario('sis.banco.orc', {}, 'ORCAMENTISTA');
    const orc = await logar('sis.banco.orc');
    await desativar(null, null);
    agora = new Date(agora.getTime() + 1000);
    cookie = orc;
    expect(await provedor().obter()).toBeNull();
    expect((await migrator.configuracaoAcesso.findUniqueOrThrow({ where: { id: 1 } })).manutencaoAPartir).toEqual(agora);
    agora = new Date(agora.getTime() + 60_000);
    cookie = await logar('sis.banco.adm');
    agora = new Date(agora.getTime() + 60_000);
    expect((await provedor().obter())?.usuarioRotulo).toBe('sis.banco.adm');
  });

  it('com x-sgo-sem-renovacao, o último acesso não muda e a sessão vence por inatividade mesmo com a consulta', async () => {
    const u = await criarUsuario('sis.aviso');
    cookie = await logar('sis.aviso');
    semRenovacao = true;
    for (const minuto of [10, 20, 29]) {
      agora = new Date(Date.parse('2026-11-11T12:00:00.000Z') + minuto * 60_000);
      expect(await provedorAviso().obter()).not.toBeNull();
    }
    expect((await migrator.sessaoUsuario.findFirstOrThrow({ where: { usuarioId: u.id } })).ultimoAcessoEm.toISOString()).toBe('2026-11-11T12:00:00.000Z');
    agora = new Date('2026-11-11T12:31:00.000Z');
    expect(await provedorAviso().obter()).toBeNull();
  });

  it('aviso (D-P9-4): os segundos que faltam para os outros; nada para quem desativou, sem contagem ou depois do prazo', async () => {
    const autor = await criarUsuario('sis.av.autor');
    const outro = await criarUsuario('sis.av.outro', {}, 'ORCAMENTISTA');
    const de = (usuarioId: string) => obterAvisoDesativacao({ usuarioId, usuarioRotulo: 'x', sessaoUid: 's', ip: null, permissoes: new Set() }, { cliente: app, agora: relogio });
    expect(await de(outro.id)).toEqual({ segundos: null });
    await desativar(autor.id);
    agora = new Date('2026-11-11T12:01:00.500Z');
    expect(await de(outro.id)).toEqual({ segundos: 240 });
    expect(await de(autor.id)).toEqual({ segundos: null });
    agora = PRAZO;
    expect(await de(outro.id)).toEqual({ segundos: null });
  });

  it('M1: sessão apagada em paralelo (logoff) durante a efetivação não ganha Histórico nem marca', async () => {
    const autor = await criarUsuario('sis.m1.autor');
    const orc = await criarUsuario('sis.m1.orc', {}, 'ORCAMENTISTA');
    await logar('sis.m1.orc');
    await desativar(autor.id);
    agora = PRAZO;
    const sessao = await migrator.sessaoUsuario.findFirstOrThrow({ where: { usuarioId: orc.id } });
    let liberar!: () => void;
    const segura = new Promise<void>((r) => (liberar = r));
    let apagou!: () => void;
    const apagada = new Promise<void>((r) => (apagou = r));
    // Outra transação apaga a sessão e segura a linha até ser liberada.
    const outra = app.$transaction(
      async (tx) => {
        await tx.sessaoUsuario.deleteMany({ where: { id: sessao.id } });
        apagou();
        await segura;
      },
      { timeout: 20_000 },
    );
    await apagada;
    const config = await obterConfiguracaoAcesso(app);
    const efetivacao = efetivarDesativacao(app, agora, config);
    await new Promise((r) => setTimeout(r, 300));
    liberar();
    await outra;
    await efetivacao;
    expect(await migrator.historicoOperacao.count({ where: { usuarioId: orc.id, descricao: { contains: 'desconectado pelo sistema' } } })).toBe(0);
    expect(await migrator.sessaoEncerrada.count({ where: { usuarioId: orc.id } })).toBe(0);
  });

  it('M1: duas efetivações em paralelo da mesma sessão → um Histórico só', async () => {
    const autor = await criarUsuario('sis.m1b.autor');
    const orc = await criarUsuario('sis.m1b.orc', {}, 'ORCAMENTISTA');
    await logar('sis.m1b.orc');
    await desativar(autor.id);
    agora = PRAZO;
    const config = await obterConfiguracaoAcesso(app);
    await Promise.all([efetivarDesativacao(app, agora, config), efetivarDesativacao(app, agora, config), efetivarDesativacao(app, agora, config)]);
    expect(await migrator.historicoOperacao.count({ where: { usuarioId: orc.id, descricao: { contains: 'desconectado pelo sistema' } } })).toBe(1);
  });

  it('M2: sessão de não administrador emitida depois do corte cai com o sistema inativo, com Histórico e marca', async () => {
    const autor = await criarUsuario('sis.m2.autor');
    const orc = await criarUsuario('sis.m2.orc', {}, 'ORCAMENTISTA');
    await desativar(autor.id);
    agora = new Date('2026-11-11T12:06:00.000Z');
    // Ex.: troca de senha no instante do prazo (emitirSessao fora do autenticar).
    const { emitirSessao } = await import('./sessao');
    const { token } = await app.$transaction((tx) =>
      emitirSessao(tx, { usuarioId: orc.id, acessoVersao: orc.acessoVersao, trocaSenhaPendente: false, ip: null, agora, maximoHoras: 12, inatividadeMin: 30, motivoAnteriores: null }),
    );
    cookie = token;
    agora = new Date('2026-11-11T12:06:30.000Z');
    expect(await provedor().obter()).toBeNull();
    expect(await sessoesDe(orc.id)).toBe(0);
    expect(await migrator.historicoOperacao.count({ where: { usuarioId: orc.id, descricao: 'Usuário sis.m2.orc desconectado pelo sistema' } })).toBe(1);
    expect(await provedor().motivoAusencia!()).toBe('SISTEMA_INATIVO');
  });

  it('M3: manutenção ligada por SQL antes de qualquer requisição: o administrador entra e não cai na requisição seguinte', async () => {
    await criarUsuario('sis.m3.adm');
    await desativar(null, null);
    agora = new Date('2026-11-11T12:10:00.000Z');
    cookie = await logar('sis.m3.adm');
    expect((await migrator.configuracaoAcesso.findUniqueOrThrow({ where: { id: 1 } })).manutencaoAPartir).toEqual(agora);
    agora = new Date('2026-11-11T12:10:05.000Z');
    expect((await provedor().obter())?.usuarioRotulo).toBe('sis.m3.adm');
  });

  it('B1: depois da reativação, motivoAusencia deixa de dizer SISTEMA_INATIVO', async () => {
    const autor = await criarUsuario('sis.b1.autor');
    await criarUsuario('sis.b1.orc', {}, 'ORCAMENTISTA');
    cookie = await logar('sis.b1.orc');
    await desativar(autor.id);
    agora = PRAZO;
    expect(await provedor().obter()).toBeNull();
    expect(await provedor().motivoAusencia!()).toBe('SISTEMA_INATIVO');
    await migrator.configuracaoAcesso.update({ where: { id: 1 }, data: { manutencao: false, manutencaoAPartir: null, manutencaoMotivo: null, manutencaoPorId: null } });
    expect(await provedor().motivoAusencia!()).toBeNull();
  });

  it('autenticar: com a desativação agendada todos entram; depois do prazo, só o Administrador (RN0023)', async () => {
    const autor = await criarUsuario('sis.login.autor');
    await criarUsuario('sis.login.orc', {}, 'ORCAMENTISTA');
    await criarUsuario('sis.login.adm');
    await desativar(autor.id);
    agora = new Date('2026-11-11T12:04:59.000Z');
    expect((await autenticar({ login: 'sis.login.orc', senha: SENHA, ip: null }, { cliente: app, agora: relogio })).ok).toBe(true);
    agora = PRAZO;
    expect(await autenticar({ login: 'sis.login.orc', senha: SENHA, ip: null }, { cliente: app, agora: relogio })).toMatchObject({ ok: false, motivo: 'MANUTENCAO' });
    expect((await autenticar({ login: 'sis.login.adm', senha: SENHA, ip: null }, { cliente: app, agora: relogio })).ok).toBe(true);
  });
});
