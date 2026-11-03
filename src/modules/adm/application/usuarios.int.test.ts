import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
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
// auditar: falha em toda chamada; naChamada: falha só na n-ésima chamada desde o beforeEach.
const falhas = vi.hoisted(() => ({ auditar: false, naChamada: 0, chamadas: 0 }));
vi.mock('@/shared/audit', async (original) => {
  const real = await original<typeof import('@/shared/audit')>();
  return {
    ...real,
    auditar: vi.fn(async (...args: Parameters<typeof real.auditar>) => {
      falhas.chamadas += 1;
      if (falhas.auditar || falhas.chamadas === falhas.naChamada) throw new Error('auditoria indisponível');
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
let estrutura = estruturaFinanceiraFalsa();
const deps = () => ({ cliente: app, agora: () => AGORA, enviarEmail: email.enviarEmail, estrutura });

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
  Object.assign(falhas, { auditar: false, naChamada: 0, chamadas: 0 });
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

describe('Histórico sem unidade', () => {
  it('com um TP selecionado, cadastro, alteração e reset saem com unidade nula (não são por TP)', async () => {
    const comTp = { ...ctx, unidadeId: unidade };
    const r = await cadastrarUsuario(comTp, dados('tito'), deps());
    if (!r.ok) throw new Error('esperava sucesso');
    const antes = await usuario(r.valor.id);
    expect((await alterarUsuario(comTp, r.valor.id, antes.versao, { ...dados('tito'), nome: 'Tito Reis' }, deps())).ok).toBe(true);
    expect((await resetarSenha(comTp, r.valor.id, deps())).ok).toBe(true);
    const h = await historico(r.valor.id);
    expect(h.length).toBeGreaterThanOrEqual(3);
    expect(h.map((x) => x.unidadeId)).toEqual(h.map(() => null));
  });
});

describe('alterarUsuario (UC02.13)', () => {
  it('não muda o login (RN0066), grava e audita o perfil novo com antes/depois, e derruba as sessões (RN0040)', async () => {
    const id = await cadastrar('bia');
    const antes = await usuario(id);
    const desde = (await historico(id)).length;
    const r = await alterarUsuario(ctx, id, antes.versao, { ...dados('outra'), nome: 'Bia Souza', perfis: ['ORCAMENTISTA', 'GFIN'] }, deps());
    expect(r).toEqual({ ok: true, valor: undefined });
    const depois = await usuario(id);
    expect(depois).toMatchObject({ login: 'bia', loginNormalizado: 'bia', nome: 'Bia Souza', email: 'outra@example.org' });
    expect(depois.perfis.map((p) => p.perfil.codigo).sort()).toEqual(['GFIN', 'ORCAMENTISTA']);
    expect(depois.versao).toBe(antes.versao + 1);
    expect(depois.acessoVersao).toBe(antes.acessoVersao + 1);
    expect(depois.atualizadoEm).toEqual(AGORA);
    const h = (await historico(id)).slice(desde);
    expect(h.map((x) => [x.tipoOperacao, x.descricao])).toEqual([
      ['ALTERACAO', 'Alterou o usuário Bia Souza'],
      ['INSERCAO', 'Perfil Gestor Financeiro (GFIN) associado ao usuário Bia Souza'],
    ]);
  });

  it('inclui e retira perfis na mesma gravação: ALTERACAO, INSERCAO e EXCLUSAO, com perfis ordenados no antes/depois', async () => {
    const id = await cadastrar('bela', { perfis: ['ORCAMENTISTA', 'GFIN'] });
    const v = (await usuario(id)).versao;
    const desde = (await historico(id)).length;
    expect((await alterarUsuario(ctx, id, v, dados('bela', { perfis: ['ORCAMENTISTA', 'AUDITOR'] }), deps())).ok).toBe(true);
    expect((await usuario(id)).perfis.map((p) => p.perfil.codigo).sort()).toEqual(['AUDITOR', 'ORCAMENTISTA']);
    const h = (await historico(id)).slice(desde);
    expect(h.map((x) => [x.tipoOperacao, x.descricao])).toEqual([
      ['ALTERACAO', 'Alterou o usuário Nome bela'],
      ['INSERCAO', 'Perfil Auditor associado ao usuário Nome bela'],
      ['EXCLUSAO', 'Perfil Gestor Financeiro (GFIN) desassociado do usuário Nome bela'],
    ]);
    expect(json(h[0])).toContain('"perfis":["GFIN","ORCAMENTISTA"]');
    expect(json(h[0])).toContain('"perfis":["AUDITOR","ORCAMENTISTA"]');
    expect(json(h)).not.toMatch(/senha|\$argon2/i);
  });

  it('só o nome mudou: as sessões continuam (acessoVersao igual)', async () => {
    const id = await cadastrar('davi');
    const antes = await usuario(id);
    expect((await alterarUsuario(ctx, id, antes.versao, { ...dados('davi'), nome: 'Davi Lima' }, deps())).ok).toBe(true);
    expect((await usuario(id)).acessoVersao).toBe(antes.acessoVersao);
  });

  it('Salvar sem mudança: não grava nem audita', async () => {
    const id = await cadastrar('dora');
    const antes = await usuario(id);
    const desde = (await historico(id)).length;
    expect(await alterarUsuario(ctx, id, antes.versao, dados('dora'), deps())).toEqual({ ok: true, valor: undefined });
    expect((await usuario(id)).versao).toBe(antes.versao);
    expect(await historico(id)).toHaveLength(desde);
  });

  it('inativar e reativar, ou mudar o CC de escopo: as sessões caem', async () => {
    const id = await cadastrar('enzo', { perfis: ['GESTOR_DIRETORIA'], ccEscopo: '4.3' });
    expect((await usuario(id)).ccEscopo).toBe('4.3');
    for (const mudanca of [{ ativo: false }, { ativo: true }, { ccEscopo: '4.4' }]) {
      const antes = await usuario(id);
      const entrada = dados('enzo', { perfis: ['GESTOR_DIRETORIA'], ccEscopo: antes.ccEscopo, ativo: antes.ativo, ...mudanca });
      expect((await alterarUsuario(ctx, id, antes.versao, entrada, deps())).ok).toBe(true);
      expect((await usuario(id)).acessoVersao).toBe(antes.acessoVersao + 1);
    }
    expect(await usuario(id)).toMatchObject({ ativo: true, ccEscopo: '4.4' });
  });

  it('CC de escopo pelo C1: inexistente, inativo ou sem analítico ativo é recusado; o já gravado é mantido', async () => {
    const recusa = { ok: false, erros: [{ campo: 'ccEscopo', mensagem: MENSAGENS_USUARIO.CC_FORA_ESTRUTURA }] };
    const gestor = (login: string, ccEscopo: string) => dados(login, { perfis: ['GESTOR_DIRETORIA'], ccEscopo });
    expect(await cadastrarUsuario(ctx, gestor('caio', '9.9'), deps())).toEqual(recusa);
    const inativar = (n: NoCentroCusto, alvo: string): NoCentroCusto => ({
      ...n,
      ativo: n.classificacao === alvo ? false : n.ativo,
      filhos: n.filhos.map((f) => inativar(f, alvo)),
    });
    try {
      estrutura = estruturaFinanceiraFalsa({ centrosCusto: CENTROS_CUSTO_EXEMPLO.map((n) => inativar(n, '4.4')) });
      expect(await cadastrarUsuario(ctx, gestor('caio', '4.4'), deps())).toEqual(recusa);
      // Sintético com analítico ativo embaixo vale (a diretoria inteira).
      const r = await cadastrarUsuario(ctx, gestor('caio', '4.3'), deps());
      if (!r.ok) throw new Error('esperava sucesso');
      // Depois que a estrutura muda, o Salvar mantém o CC gravado, mas não aceita trocar para outro fora dela.
      estrutura = estruturaFinanceiraFalsa({ centrosCusto: CENTROS_CUSTO_EXEMPLO.map((n) => inativar(inativar(n, '4.3.0'), '4.3.2')) });
      // Sintético ativo sem nenhum analítico ativo embaixo, como valor novo: recusado (não basta existir).
      expect(await cadastrarUsuario(ctx, gestor('quim', '4.3'), deps())).toEqual(recusa);
      const antes = await usuario(r.valor.id);
      expect(await alterarUsuario(ctx, r.valor.id, antes.versao, { ...gestor('caio', '4.3'), nome: 'Caio Lima' }, deps())).toEqual({ ok: true, valor: undefined });
      const depois = await usuario(r.valor.id);
      expect(await alterarUsuario(ctx, r.valor.id, depois.versao, gestor('caio', '4.3.2'), deps())).toEqual(recusa);
      expect(await usuario(r.valor.id)).toMatchObject({ nome: 'Caio Lima', ccEscopo: '4.3' });
    } finally {
      estrutura = estruturaFinanceiraFalsa();
    }
  });

  it('unidades: troca, esvazia e recusa unidade inativa nova; sem derrubar as sessões', async () => {
    const outra = (await migrator.unidade.create({ data: { codigo: 'TP-2', nome: 'TP 2' } })).id;
    const inativa = (await migrator.unidade.create({ data: { codigo: 'TP-X', nome: 'TP X', ativo: false } })).id;
    const id = await cadastrar('fred', { unidades: [unidade] });
    const vinculos = async () => (await migrator.usuarioUnidade.findMany({ where: { usuarioId: id } })).map((x) => x.unidadeId);
    let antes = await usuario(id);
    expect((await alterarUsuario(ctx, id, antes.versao, dados('fred', { unidades: [outra] }), deps())).ok).toBe(true);
    expect(await vinculos()).toEqual([outra]);
    expect((await usuario(id)).acessoVersao).toBe(antes.acessoVersao);
    antes = await usuario(id);
    expect(await alterarUsuario(ctx, id, antes.versao, dados('fred', { unidades: [outra, inativa] }), deps())).toEqual({
      ok: false,
      erros: [{ campo: 'unidades', mensagem: MENSAGENS_USUARIO.UNIDADE_INVALIDA }],
    });
    expect((await alterarUsuario(ctx, id, antes.versao, dados('fred', { unidades: [] }), deps())).ok).toBe(true);
    expect(await vinculos()).toEqual([]);
  });

  it('perfil e TP já vinculados e depois inativados não impedem alterar o resto', async () => {
    const tp = (await migrator.unidade.create({ data: { codigo: 'TP-3', nome: 'TP 3' } })).id;
    const id = await cadastrar('gabi', { perfis: ['OPERADOR_VIAGENS'], unidades: [tp] });
    await migrator.perfil.update({ where: { codigo: 'OPERADOR_VIAGENS' }, data: { ativo: false } });
    await migrator.unidade.update({ where: { id: tp }, data: { ativo: false } });
    try {
      const v = (await usuario(id)).versao;
      const r = await alterarUsuario(ctx, id, v, dados('gabi', { nome: 'Gabi Reis', perfis: ['OPERADOR_VIAGENS'], unidades: [tp] }), deps());
      expect(r).toEqual({ ok: true, valor: undefined });
      expect((await usuario(id)).nome).toBe('Gabi Reis');
    } finally {
      await migrator.perfil.update({ where: { codigo: 'OPERADOR_VIAGENS' }, data: { ativo: true } });
    }
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

  it('entrada inválida: erro de campo, nada gravado', async () => {
    const id = await cadastrar('hana');
    const antes = await usuario(id);
    expect(await alterarUsuario(ctx, id, antes.versao, dados('hana', { perfis: [] }), deps())).toEqual({
      ok: false,
      erros: [{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_OBRIGATORIO }],
    });
    expect((await usuario(id)).versao).toBe(antes.versao);
  });
});

describe('último administrador', () => {
  // Administradores que já passaram do primeiro acesso; os outros usuários ficam inativos.
  async function soEstesAdministradores(...logins: string[]): Promise<string[]> {
    const ids = [];
    for (const login of logins) ids.push(await cadastrar(login, { perfis: ['ADMINISTRADOR'] }));
    await migrator.usuario.updateMany({ where: { id: { in: ids } }, data: { trocaSenhaObrigatoria: false } });
    await migrator.usuario.updateMany({ where: { id: { notIn: ids } }, data: { ativo: false } });
    return ids;
  }
  const reativarTodos = () => migrator.usuario.updateMany({ data: { ativo: true } });
  const ultimo = { ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.ULTIMO_ADMINISTRADOR }] };

  it('em paralelo, dois tirando o perfil um do outro: um sucesso e uma recusa; inativar o restante é recusado', async () => {
    try {
      const [a, b] = await soEstesAdministradores('adm.a', 'adm.b');
      const [va, vb] = [(await usuario(a!)).versao, (await usuario(b!)).versao];
      const r = await Promise.all([
        alterarUsuario(ctx, a!, va, dados('adm.a', { perfis: ['GFIN'] }), deps()),
        alterarUsuario(ctx, b!, vb, dados('adm.b', { perfis: ['GFIN'] }), deps()),
      ]);
      expect(r.filter((x) => x.ok)).toHaveLength(1);
      expect(r.find((x) => !x.ok)).toEqual(ultimo);
      const restante = r[0]!.ok ? b! : a!;
      const login = restante === a ? 'adm.a' : 'adm.b';
      const v = (await usuario(restante)).versao;
      expect(await alterarUsuario(ctx, restante, v, dados(login, { perfis: ['ADMINISTRADOR'], ativo: false }), deps())).toEqual(ultimo);
    } finally {
      await reativarTodos();
    }
  });

  it('a checagem espera a trava de administradores (adm:administradores)', async () => {
    try {
      const [c, d] = await soEstesAdministradores('adm.c', 'adm.d');
      let liberar!: () => void;
      const segura = new Promise<void>((r) => (liberar = r));
      let travou!: () => void;
      const travada = new Promise<void>((r) => (travou = r));
      const intrusa = migrator.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('adm:administradores'))`;
          travou();
          await segura;
        },
        { timeout: 15_000 },
      );
      await travada;
      let terminou = false;
      const v = (await usuario(c!)).versao;
      const p = alterarUsuario(ctx, c!, v, dados('adm.c', { perfis: ['GFIN'] }), deps()).then((r) => ((terminou = true), r));
      await new Promise((r) => setTimeout(r, 500));
      expect(terminou).toBe(false);
      liberar();
      await intrusa;
      expect((await p).ok).toBe(true);
      expect(d).toBeDefined();
    } finally {
      await reativarTodos();
    }
  });

  it('o outro Administrador ainda com a senha temporária não conta', async () => {
    try {
      const [e] = await soEstesAdministradores('adm.e');
      await cadastrar('adm.f', { perfis: ['ADMINISTRADOR'] }); // nunca entrou: troca obrigatória
      const v = (await usuario(e!)).versao;
      expect(await alterarUsuario(ctx, e!, v, dados('adm.e', { perfis: ['GFIN'] }), deps())).toEqual(ultimo);
    } finally {
      await reativarTodos();
    }
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
    const ultimo = (await historico(id)).at(-1);
    expect(ultimo).toMatchObject({ tipoOperacao: 'ALTERACAO', descricao: 'Desbloqueou o usuário Nome gil' });
    expect(json(ultimo)).toContain('"tentativasFalhas":5');
  });

  it('inativo ou não bloqueado: erro, nada muda (RN0063)', async () => {
    const id = await cadastrar('hugo');
    const erro = { ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.DESBLOQUEIO_INATIVO }] };
    expect(await desbloquearUsuario(ctx, id, deps())).toEqual(erro);
    await migrator.usuario.update({ where: { id }, data: { bloqueado: true, ativo: false } });
    expect(await desbloquearUsuario(ctx, id, deps())).toEqual(erro);
    expect((await usuario(id)).bloqueado).toBe(true);
  });
});

describe('resetarSenha (UC02.13 A2, UC02.18)', () => {
  it('grava uma senha temporária nova, envia a redefinição, derruba as sessões e audita, sem mudar a versão do formulário', async () => {
    const id = await cadastrar('ivo');
    await migrator.usuario.update({ where: { id }, data: { trocaSenhaObrigatoria: false, senhaExpiraEm: null } });
    const antes = await usuario(id);
    email = emailFalso();
    expect(await resetarSenha(ctx, id, deps())).toEqual({ ok: true, valor: undefined });
    const depois = await usuario(id);
    expect(depois.senhaHash).not.toBe(antes.senhaHash);
    expect(depois).toMatchObject({ trocaSenhaObrigatoria: true, acessoVersao: antes.acessoVersao + 1, versao: antes.versao });
    expect(depois.senhaExpiraEm).toEqual(new Date(AGORA.getTime() + 24 * 3600_000));
    expect(email.enviados).toHaveLength(1);
    expect(email.enviados[0]).toMatchObject({ modelo: 'usuario.senha_redefinida', dados: { login: 'ivo', urlAcesso: URL_ACESSO } });
    expect(await conferirSenha(depois.senhaHash, email.enviados[0]!.dados.senhaTemporaria)).toBe(true);
    const ultimo = (await historico(id)).at(-1);
    expect(ultimo).toMatchObject({ tipoOperacao: 'ALTERACAO', descricao: 'Gerou nova senha para o usuário Nome ivo' });
    expect(json(ultimo)).toContain('"temporariaExpiraEm"');
    expect(json(ultimo)).not.toMatch(/\$argon2/);
    // O formulário continua aberto (A2): o Salvar seguinte, com a versão lida antes, passa.
    expect((await alterarUsuario(ctx, id, antes.versao, { ...dados('ivo'), nome: 'Ivo Melo' }, deps())).ok).toBe(true);
  });

  it('usuário inativo ou a própria conta: erro, nada muda e nenhum e-mail', async () => {
    const id = await cadastrar('jair');
    await migrator.usuario.update({ where: { id }, data: { ativo: false } });
    const antes = await usuario(id);
    expect(await resetarSenha(ctx, id, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_INATIVO }] });
    expect(await resetarSenha(ctx, ctx.usuarioId, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_PROPRIO }] });
    expect((await usuario(id)).senhaHash).toBe(antes.senhaHash);
    expect(email.enviados.filter((e) => e.modelo === 'usuario.senha_redefinida')).toEqual([]);
  });
  it('usuário bloqueado: pede o desbloqueio antes, nada muda e nenhum e-mail', async () => {
    const id = await cadastrar('jonas');
    await migrator.usuario.update({ where: { id }, data: { bloqueado: true, tentativasFalhas: 5 } });
    const antes = await usuario(id);
    const desde = (await historico(id)).length;
    expect(await resetarSenha(ctx, id, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.RESET_BLOQUEADO }] });
    expect(await usuario(id)).toMatchObject({ senhaHash: antes.senhaHash, acessoVersao: antes.acessoVersao, versao: antes.versao, bloqueado: true });
    expect(await historico(id)).toHaveLength(desde);
    expect(email.enviados.filter((e) => e.modelo === 'usuario.senha_redefinida')).toEqual([]);
  });
});

describe('usuário inexistente', () => {
  const NAO_EXISTE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  it.each([[NAO_EXISTE], ['abc']])('%s: os mutadores lançam adm.usuario_inexistente e obterUsuario dá null', async (id) => {
    const inexistente = expect.objectContaining({ codigo: 'adm.usuario_inexistente' });
    await expect(alterarUsuario(ctx, id, 0, dados('nadia'), deps())).rejects.toEqual(inexistente);
    await expect(resetarSenha(ctx, id, deps())).rejects.toEqual(inexistente);
    await expect(desbloquearUsuario(ctx, id, deps())).rejects.toEqual(inexistente);
    expect(await obterUsuario(ctx, id, deps())).toBeNull();
  });
});

describe('consulta', () => {
  it('listarUsuarios (por nome) e obterUsuario trazem os dados sem senha', async () => {
    const id = await cadastrar('juca', { unidades: [unidade] });
    const lista = await listarUsuarios(ctx, deps());
    expect(lista.find((u) => u.id === id)).toEqual({ id, nome: 'Nome juca', login: 'juca', ativo: true, bloqueado: false });
    // Ordem por nome na collation do banco (ignora caixa e pontuação): confere só nomes conhecidos.
    const posicao = (nome: string) => lista.findIndex((x) => x.nome === nome);
    expect(posicao('Nome juca')).toBeGreaterThan(posicao('Bia Souza'));
    expect(posicao('Raiz')).toBeGreaterThan(posicao('Nome juca'));
    const u = await obterUsuario(ctx, id, deps());
    expect(u).toMatchObject({ id, login: 'juca', perfis: ['ORCAMENTISTA'], unidades: [unidade], ccEscopo: null });
    expect(JSON.stringify(u)).not.toMatch(/senha/i);
  });
});

describe('permissão (§10.2, item 3)', () => {
  const com = (...p: string[]) => ({ ...ctx, permissoes: new Set(p) });

  it('cada caso de uso exige a sua ação, antes de validar a entrada; nada gravado', async () => {
    const id = await cadastrar('kiko2');
    const soConsulta = com('adm.usuarios:consultar');
    await expect(cadastrarUsuario(soConsulta, { lixo: true }, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(alterarUsuario(soConsulta, id, 0, {}, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(resetarSenha(soConsulta, id, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(desbloquearUsuario(soConsulta, id, deps())).rejects.toBeInstanceOf(ErroPermissao);
    const nada = com();
    await expect(listarUsuarios(nada, deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(obterUsuario(nada, id, deps())).rejects.toBeInstanceOf(ErroPermissao);
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'kiko' } })).toBe(0);
  });

  it('pela definirAcao: 403 com a negação auditada, nada gravado e nenhum e-mail', async () => {
    const negacoes: EventoAuditoria[] = [];
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => com('adm.usuarios:consultar') });
    configurarAuditorNegacao(async (e) => {
      negacoes.push(e);
    });
    const acao = definirAcao({ funcionalidade: 'adm.usuarios', acao: 'incluir', entrada: z.unknown() }, (e, c) =>
      cadastrarUsuario(c, e, deps()),
    );
    expect(await acao(dados('kiko'))).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toHaveLength(1);
    expect(negacoes[0]).toMatchObject({ funcionalidade: 'adm.usuarios', contexto: { usuarioId: ctx.usuarioId } });
    expect(negacoes[0]!.descricao).toContain('incluir');
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'kiko' } })).toBe(0);
    expect(email.enviados).toEqual([]);
  });
});

describe('atomicidade (§10.2, item 1)', () => {
  const nadaDe = async (login: string) => {
    expect(await migrator.usuario.count({ where: { loginNormalizado: login } })).toBe(0);
    expect(await migrator.historicoOperacao.count({ where: { descricao: { contains: `Nome ${login}` } } })).toBe(0);
  };

  it('cadastro com a 2ª auditoria falhando: nem usuário, nem vínculos, nem Histórico', async () => {
    falhas.naChamada = 2;
    const antesVinculos = await migrator.usuarioUnidade.count();
    await expect(cadastrarUsuario(ctx, dados('lia', { perfis: ['ORCAMENTISTA', 'GFIN'], unidades: [unidade] }), deps())).rejects.toThrow(
      'auditoria indisponível',
    );
    await nadaDe('lia');
    expect(await migrator.usuarioUnidade.count()).toBe(antesVinculos);
  });

  it('cadastro com o e-mail falhando: nada gravado', async () => {
    const quebrado = { ...deps(), enviarEmail: async () => Promise.reject(new Error('outbox indisponível')) };
    await expect(cadastrarUsuario(ctx, dados('lia'), quebrado)).rejects.toThrow('outbox indisponível');
    await nadaDe('lia');
  });

  it('alteração com a auditoria falhando: versão, perfis e unidades como antes', async () => {
    const id = await cadastrar('lara', { unidades: [unidade] });
    const antes = await usuario(id);
    falhas.auditar = true;
    await expect(alterarUsuario(ctx, id, antes.versao, dados('lara', { nome: 'Lara Dias', perfis: ['GFIN'], unidades: [] }), deps())).rejects.toThrow(
      'auditoria indisponível',
    );
    const depois = await usuario(id);
    expect(depois).toMatchObject({ nome: 'Nome lara', versao: antes.versao, acessoVersao: antes.acessoVersao });
    expect(depois.perfis.map((p) => p.perfil.codigo)).toEqual(['ORCAMENTISTA']);
    expect(await migrator.usuarioUnidade.count({ where: { usuarioId: id } })).toBe(1);
  });

  it('reset com o e-mail falhando e desbloqueio com a auditoria falhando: nada muda', async () => {
    const id = await cadastrar('leo');
    const desde = (await historico(id)).length;
    // O reset vem antes do bloqueio: usuário bloqueado nem chega ao e-mail (RESET_BLOQUEADO).
    const antesReset = await usuario(id);
    const quebrado = { ...deps(), enviarEmail: async () => Promise.reject(new Error('outbox indisponível')) };
    await expect(resetarSenha(ctx, id, quebrado)).rejects.toThrow('outbox indisponível');
    expect(await usuario(id)).toMatchObject({
      senhaHash: antesReset.senhaHash,
      acessoVersao: antesReset.acessoVersao,
      senhaExpiraEm: antesReset.senhaExpiraEm,
      trocaSenhaObrigatoria: antesReset.trocaSenhaObrigatoria,
    });
    await migrator.usuario.update({ where: { id }, data: { bloqueado: true, tentativasFalhas: 5 } });
    const antes = await usuario(id);
    falhas.auditar = true;
    await expect(desbloquearUsuario(ctx, id, deps())).rejects.toThrow('auditoria indisponível');
    const depois = await usuario(id);
    expect(depois).toMatchObject({
      senhaHash: antes.senhaHash,
      acessoVersao: antes.acessoVersao,
      versao: antes.versao,
      senhaExpiraEm: antes.senhaExpiraEm,
      bloqueado: true,
      tentativasFalhas: 5,
    });
    expect(await historico(id)).toHaveLength(desde);
  });
});

describe('reset com bloqueio entre a leitura e a gravação', () => {
  it('o bloqueio por tentativas não muda a versão, mas o reset não passa por ele', async () => {
    const id = await cadastrar('otto');
    const antes = await usuario(id);
    const ligar = <T extends object>(alvo: T, p: string | symbol) => {
      const v = Reflect.get(alvo, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
    };
    // Logo depois da leitura do reset, um login errado bloqueia o usuário (sem mexer na versão).
    const corrida = new Proxy(app, {
      get(alvo, prop) {
        if (prop !== '$transaction') return ligar(alvo, prop);
        return (fn: (tx: unknown) => Promise<unknown>) =>
          alvo.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(t, q) {
                  if (q !== 'usuario') return ligar(t, q);
                  return new Proxy(t.usuario, {
                    get: (u, m) =>
                      m === 'findUnique'
                        ? async (args: unknown) => {
                            const lido = await u.findUnique(args as Parameters<typeof u.findUnique>[0]);
                            await migrator.usuario.update({ where: { id }, data: { bloqueado: true, tentativasFalhas: 5 } });
                            return lido;
                          }
                        : ligar(u, m),
                  });
                },
              }),
            ),
          );
      },
    });
    const r = await resetarSenha(ctx, id, { ...deps(), cliente: corrida });
    expect(r.ok).toBe(false);
    expect(await usuario(id)).toMatchObject({ senhaHash: antes.senhaHash, bloqueado: true });
    expect(email.enviados.filter((e) => e.modelo === 'usuario.senha_redefinida')).toEqual([]);
  });
});

describe('login duplicado decidido pelo índice único', () => {
  it('a checagem prévia não vê o outro cadastro: o P2002 vira "Login já cadastrado" e nada é enviado', async () => {
    await cadastrar('nina');
    email = emailFalso();
    // O tx devolve null na checagem prévia, como se o outro cadastro ainda não tivesse sido gravado.
    const ligar = <T extends object>(alvo: T, p: string | symbol) => {
      const v = Reflect.get(alvo, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
    };
    const cego = new Proxy(app, {
      get(alvo, prop) {
        if (prop !== '$transaction') return ligar(alvo, prop);
        return (fn: (tx: unknown) => Promise<unknown>) =>
          alvo.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(t, q) {
                  if (q !== 'usuario') return ligar(t, q);
                  return new Proxy(t.usuario, { get: (u, m) => (m === 'findUnique' ? async () => null : ligar(u, m)) });
                },
              }),
            ),
          );
      },
    });
    const r = await cadastrarUsuario(ctx, dados('NINA'), { ...deps(), cliente: cego });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'login', mensagem: MENSAGENS_USUARIO.LOGIN_DUPLICADO }] });
    expect(email.enviados).toEqual([]);
  });
});
