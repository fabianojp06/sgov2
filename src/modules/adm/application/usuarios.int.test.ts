import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { emailFalso } from '@/modules/ger';
import type { EventoAuditoria } from '@/shared/audit';
import { definirAcao, ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { lerEnvAcesso } from '@/shared/config';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_USUARIO } from '../domain/usuario';
import { seedAdm } from '../infrastructure/seed';
import { conferirSenha } from '../infrastructure/senha-argon2';
import { alterarUsuario, cadastrarUsuario, desbloquearUsuario, listarUsuarios, obterUsuario, resetarSenha } from './usuarios';

// Falhas injetadas na auditoria (R13 do plano: vi.spyOn não alcança export ESM).
const falhas = vi.hoisted(() => ({ auditar: false }));
vi.mock('@/shared/audit', async (original) => {
  const real = await original<typeof import('@/shared/audit')>();
  return {
    ...real,
    auditar: vi.fn(async (...args: Parameters<typeof real.auditar>) => {
      if (falhas.auditar) throw new Error('auditoria indisponível');
      return real.auditar(...args);
    }),
  };
});

// Casos de uso de usuário (US-038 parte 1): cadastro, alteração, desbloqueio e reset de senha.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let email: ReturnType<typeof emailFalso>;
let ctx: ContextoRequisicao;
let unidade: string;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
const URL_ACESSO = `${lerEnvAcesso().urlPublica}/login`;
const deps = () => ({ cliente: app, agora: () => AGORA, enviarEmail: email.enviarEmail });

const dados = (login: string, extra: Record<string, unknown> = {}) => ({
  nome: `Nome ${login}`,
  email: `${login}@example.org`,
  login,
  ativo: true,
  perfis: ['ORCAMENTISTA'],
  unidades: [] as string[],
  ccEscopo: null,
  ...extra,
});

async function cadastrar(login: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await cadastrarUsuario(ctx, dados(login, extra), deps());
  if (!r.ok) throw new Error(`cadastro falhou: ${JSON.stringify(r.erros)}`);
  return r.valor.id;
}

const usuario = (id: string) => migrator.usuario.findUniqueOrThrow({ where: { id }, include: { perfis: { include: { perfil: true } } } });
// O id do Histórico é BigInt, que o JSON.stringify não serializa.
const json = (v: unknown) => JSON.stringify(v, (_c, x: unknown) => (typeof x === 'bigint' ? String(x) : x));
const historico = (registroId: string) => migrator.historicoOperacao.findMany({ where: { registroId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  const raiz = await migrator.usuario.create({
    data: { nome: 'Raiz', email: 'raiz@example.org', login: 'raiz', loginNormalizado: 'raiz', senhaHash: 'x' },
  });
  ctx = {
    usuarioId: raiz.id,
    usuarioRotulo: 'raiz',
    sessaoUid: 's-raiz',
    ip: '203.0.113.1',
    permissoes: new Set(['adm.usuarios:consultar', 'adm.usuarios:incluir', 'adm.usuarios:alterar']),
  };
  unidade = (await migrator.unidade.create({ data: { codigo: 'TP-1', nome: 'TP 1' } })).id;
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(() => {
  email = emailFalso();
  falhas.auditar = false;
});

describe('cadastrarUsuario (UC02.12)', () => {
  it('cria com troca obrigatória e senha de 24 h, envia a senha inicial e audita sem senha (RN0071, RN0056)', async () => {
    const id = await cadastrar('ana', { perfis: ['ORCAMENTISTA', 'GFIN'], unidades: [unidade] });
    const u = await usuario(id);
    expect(u).toMatchObject({ login: 'ana', loginNormalizado: 'ana', trocaSenhaObrigatoria: true, ativo: true, bloqueado: false });
    expect(u.senhaExpiraEm).toEqual(new Date(AGORA.getTime() + 24 * 3600_000));
    expect(u.perfis.map((p) => p.perfil.codigo).sort()).toEqual(['GFIN', 'ORCAMENTISTA']);
    expect(await migrator.usuarioUnidade.findMany({ where: { usuarioId: id } })).toEqual([{ usuarioId: id, unidadeId: unidade }]);

    expect(email.enviados).toHaveLength(1);
    const [envio] = email.enviados;
    expect(envio).toMatchObject({ modelo: 'usuario.senha_inicial', destinatario: { email: 'ana@example.org', nome: 'Nome ana' } });
    expect(envio!.dados).toMatchObject({ nome: 'Nome ana', login: 'ana', urlAcesso: URL_ACESSO });
    expect(await conferirSenha(u.senhaHash, envio!.dados.senhaTemporaria)).toBe(true);

    const h = await historico(id);
    expect(h.map((x) => [x.tipoOperacao, x.descricao])).toEqual([
      ['INSERCAO', 'Cadastrou o usuário Nome ana'],
      ['INSERCAO', 'Perfil Orçamentista associado ao usuário Nome ana'],
      ['INSERCAO', 'Perfil Gestor Financeiro (GFIN) associado ao usuário Nome ana'],
    ]);
    expect(json(h)).not.toMatch(/senha|\$argon2/i);
    expect(h[0]).toMatchObject({ usuarioId: ctx.usuarioId, funcionalidade: 'adm.usuarios' });
  });

  it('login duplicado sem diferenciar maiúsculas: "Login já cadastrado" (RN0065)', async () => {
    await cadastrar('joao');
    const r = await cadastrarUsuario(ctx, dados('Joao'), deps());
    expect(r).toEqual({ ok: false, erros: [{ campo: 'login', mensagem: MENSAGENS_USUARIO.LOGIN_DUPLICADO }] });
  });

  it('dois cadastros simultâneos do mesmo login: um entra, o outro recebe "Login já cadastrado"', async () => {
    const r = await Promise.all([cadastrarUsuario(ctx, dados('maria'), deps()), cadastrarUsuario(ctx, dados('MARIA'), deps())]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.find((x) => !x.ok)).toEqual({ ok: false, erros: [{ campo: 'login', mensagem: MENSAGENS_USUARIO.LOGIN_DUPLICADO }] });
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'maria' } })).toBe(1);
  });

  it('perfil inativo ou unidade inexistente: erro de campo e nada gravado', async () => {
    await migrator.perfil.update({ where: { codigo: 'AUDITOR' }, data: { ativo: false } });
    try {
      expect(await cadastrarUsuario(ctx, dados('caio', { perfis: ['AUDITOR'] }), deps())).toEqual({
        ok: false,
        erros: [{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_INVALIDO }],
      });
    } finally {
      await migrator.perfil.update({ where: { codigo: 'AUDITOR' }, data: { ativo: true } });
    }
    const r = await cadastrarUsuario(ctx, dados('caio', { unidades: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'] }), deps());
    expect(r).toEqual({ ok: false, erros: [{ campo: 'unidades', mensagem: MENSAGENS_USUARIO.UNIDADE_INVALIDA }] });
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'caio' } })).toBe(0);
    expect(email.enviados).toEqual([]);
  });
});

describe('alterarUsuario (UC02.13)', () => {
  it('não muda o login (RN0066), audita a alteração e o perfil novo, e derruba as sessões (RN0040)', async () => {
    const id = await cadastrar('bia');
    const antes = await usuario(id);
    const r = await alterarUsuario(ctx, id, antes.versao, { ...dados('outra'), nome: 'Bia Souza', perfis: ['ORCAMENTISTA', 'GFIN'] }, deps());
    expect(r).toEqual({ ok: true, valor: undefined });
    const depois = await usuario(id);
    expect(depois).toMatchObject({ login: 'bia', loginNormalizado: 'bia', nome: 'Bia Souza', email: 'outra@example.org' });
    expect(depois.versao).toBe(antes.versao + 1);
    expect(depois.acessoVersao).toBe(antes.acessoVersao + 1);
    const h = (await historico(id)).slice(-2).map((x) => [x.tipoOperacao, x.descricao]);
    expect(h).toEqual([
      ['ALTERACAO', 'Alterou o usuário Bia Souza'],
      ['INSERCAO', 'Perfil Gestor Financeiro (GFIN) associado ao usuário Bia Souza'],
    ]);
  });

  it('só o nome mudou: as sessões continuam (acessoVersao igual)', async () => {
    const id = await cadastrar('davi');
    const antes = await usuario(id);
    expect((await alterarUsuario(ctx, id, antes.versao, { ...dados('davi'), nome: 'Davi Lima' }, deps())).ok).toBe(true);
    expect((await usuario(id)).acessoVersao).toBe(antes.acessoVersao);
  });

  it('versão velha: erro de concorrência, nada muda', async () => {
    const id = await cadastrar('edu');
    const v = (await usuario(id)).versao;
    expect((await alterarUsuario(ctx, id, v, { ...dados('edu'), nome: 'Primeira' }, deps())).ok).toBe(true);
    expect(await alterarUsuario(ctx, id, v, { ...dados('edu'), nome: 'Segunda' }, deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.ALTERADO }],
    });
    expect((await usuario(id)).nome).toBe('Primeira');
  });

  it('perfil retirado: "Perfil … desassociado do usuário …"', async () => {
    const id = await cadastrar('fabi', { perfis: ['ORCAMENTISTA', 'GFIN'] });
    const v = (await usuario(id)).versao;
    expect((await alterarUsuario(ctx, id, v, dados('fabi'), deps())).ok).toBe(true);
    expect((await historico(id)).at(-1)?.descricao).toBe('Perfil Gestor Financeiro (GFIN) desassociado do usuário Nome fabi');
  });
});

describe('último administrador', () => {
  it('tirar o perfil ou inativar o único administrador ativo: erro geral; em paralelo, um sucesso e uma recusa', async () => {
    const a = await cadastrar('adm.a', { perfis: ['ADMINISTRADOR'] });
    const b = await cadastrar('adm.b', { perfis: ['ADMINISTRADOR'] });
    // Só os dois ficam como administradores ativos.
    await migrator.usuario.updateMany({ where: { id: { notIn: [a, b] } }, data: { ativo: false } });
    const [va, vb] = [(await usuario(a)).versao, (await usuario(b)).versao];
    const r = await Promise.all([
      alterarUsuario(ctx, a, va, dados('adm.a', { perfis: ['GFIN'] }), deps()),
      alterarUsuario(ctx, b, vb, dados('adm.b', { perfis: ['GFIN'] }), deps()),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.find((x) => !x.ok)).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.ULTIMO_ADMINISTRADOR }] });

    const restante = r[0]!.ok ? b : a;
    const v = (await usuario(restante)).versao;
    const login = restante === a ? 'adm.a' : 'adm.b';
    expect(await alterarUsuario(ctx, restante, v, dados(login, { perfis: ['ADMINISTRADOR'], ativo: false }), deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.ULTIMO_ADMINISTRADOR }],
    });
    await migrator.usuario.updateMany({ data: { ativo: true } });
  });
});

describe('desbloquearUsuario (UC02.13 A3)', () => {
  it('bloqueado e ativo: desbloqueia, zera o contador, derruba as sessões e audita (RN0045, RN0053)', async () => {
    const id = await cadastrar('gil');
    await migrator.usuario.update({ where: { id }, data: { bloqueado: true, tentativasFalhas: 5 } });
    const antes = await usuario(id);
    expect(await desbloquearUsuario(ctx, id, deps())).toEqual({ ok: true, valor: undefined });
    const depois = await usuario(id);
    expect(depois).toMatchObject({ bloqueado: false, tentativasFalhas: 0, acessoVersao: antes.acessoVersao + 1 });
    expect((await historico(id)).at(-1)).toMatchObject({ tipoOperacao: 'ALTERACAO', descricao: 'Desbloqueou o usuário Nome gil' });
  });

  it('inativo ou não bloqueado: erro, nada muda (RN0063)', async () => {
    const id = await cadastrar('hugo');
    expect(await desbloquearUsuario(ctx, id, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.DESBLOQUEIO_INATIVO }] });
    await migrator.usuario.update({ where: { id }, data: { bloqueado: true, ativo: false } });
    expect(await desbloquearUsuario(ctx, id, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.DESBLOQUEIO_INATIVO }] });
    expect((await usuario(id)).bloqueado).toBe(true);
  });
});

describe('resetarSenha (UC02.13 A2, UC02.18)', () => {
  it('grava uma senha temporária nova, envia a redefinição, derruba as sessões e audita', async () => {
    const id = await cadastrar('ivo');
    await migrator.usuario.update({ where: { id }, data: { trocaSenhaObrigatoria: false, senhaExpiraEm: null } });
    const antes = await usuario(id);
    email = emailFalso();
    expect(await resetarSenha(ctx, id, deps())).toEqual({ ok: true, valor: undefined });
    const depois = await usuario(id);
    expect(depois.senhaHash).not.toBe(antes.senhaHash);
    expect(depois).toMatchObject({ trocaSenhaObrigatoria: true, acessoVersao: antes.acessoVersao + 1 });
    expect(depois.senhaExpiraEm).toEqual(new Date(AGORA.getTime() + 24 * 3600_000));
    expect(email.enviados).toHaveLength(1);
    expect(email.enviados[0]).toMatchObject({ modelo: 'usuario.senha_redefinida', dados: { login: 'ivo', urlAcesso: URL_ACESSO } });
    expect(await conferirSenha(depois.senhaHash, email.enviados[0]!.dados.senhaTemporaria)).toBe(true);
    const ultimo = (await historico(id)).at(-1);
    expect(ultimo).toMatchObject({ tipoOperacao: 'ALTERACAO', descricao: 'Gerou nova senha para o usuário Nome ivo' });
    expect(json(ultimo)).not.toMatch(/\$argon2/);
  });
});

describe('consulta', () => {
  it('listarUsuarios e obterUsuario trazem os dados sem senha', async () => {
    const id = await cadastrar('juca', { unidades: [unidade] });
    const lista = await listarUsuarios(ctx, deps());
    expect(lista.find((u) => u.id === id)).toEqual({ id, nome: 'Nome juca', login: 'juca', ativo: true, bloqueado: false });
    const u = await obterUsuario(ctx, id, deps());
    expect(u).toMatchObject({ id, login: 'juca', perfis: ['ORCAMENTISTA'], unidades: [unidade], ccEscopo: null });
    expect(JSON.stringify(u)).not.toMatch(/senha/i);
    expect(await obterUsuario(ctx, '7c9e6679-7425-40de-944b-e07fc1f90ae7', deps())).toBeNull();
  });
});

describe('permissão (§10.2, item 3)', () => {
  const semIncluir = () => ({ ...ctx, permissoes: new Set(['adm.usuarios:consultar']) });

  it('sem adm.usuarios:incluir: ErroPermissao, nada gravado', async () => {
    await expect(cadastrarUsuario(semIncluir(), dados('kiko'), deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(resetarSenha(semIncluir(), ctx.usuarioId, deps())).rejects.toBeInstanceOf(ErroPermissao);
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'kiko' } })).toBe(0);
  });

  it('pela definirAcao: 403 com a negação auditada', async () => {
    const negacoes: EventoAuditoria[] = [];
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => semIncluir() });
    configurarAuditorNegacao(async (e) => {
      negacoes.push(e);
    });
    const acao = definirAcao({ funcionalidade: 'adm.usuarios', acao: 'incluir', entrada: z.unknown() }, (e, c) =>
      cadastrarUsuario(c, e, deps()),
    );
    expect(await acao(dados('kiko'))).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toHaveLength(1);
  });
});

describe('atomicidade (§10.2, item 1)', () => {
  it('auditoria falhando: nada gravado', async () => {
    falhas.auditar = true;
    await expect(cadastrarUsuario(ctx, dados('lia'), deps())).rejects.toThrow('auditoria indisponível');
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'lia' } })).toBe(0);
  });

  it('envio do e-mail falhando: nada gravado', async () => {
    const quebrado = { ...deps(), enviarEmail: async () => Promise.reject(new Error('outbox indisponível')) };
    await expect(cadastrarUsuario(ctx, dados('lia'), quebrado)).rejects.toThrow('outbox indisponível');
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'lia' } })).toBe(0);
    const id = await cadastrar('lia');
    const antes = await usuario(id);
    await expect(resetarSenha(ctx, id, quebrado)).rejects.toThrow('outbox indisponível');
    expect((await usuario(id)).senhaHash).toBe(antes.senhaHash);
  });
});
