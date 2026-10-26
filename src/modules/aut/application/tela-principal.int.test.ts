import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSenha, seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';
import { criarProvedorContexto } from './provedor-contexto';
import { carregarTelaPrincipal, validarTrocaUnidade } from './tela-principal';

// Tela principal (US-031): menu do catálogo ativo, unidades do usuário e unidade ativa.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
const SENHA = `Certa${Date.now()}x`;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
let unidades: { a: string; b: string; inativa: string };

async function logado(login: string, perfil: string, unidadesDoUsuario: string[], cookieUnidade?: string): Promise<ContextoRequisicao> {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: perfil } });
  await migrator.usuario.create({
    data: {
      nome: `Nome ${login}`,
      email: `${login}@exemplo.org`,
      login,
      loginNormalizado: login,
      senhaHash: await hashSenha(SENHA),
      trocaSenhaObrigatoria: false,
      perfis: { create: { perfilId: p.id } },
      unidades: { create: unidadesDoUsuario.map((unidadeId) => ({ unidadeId })) },
    },
  });
  const r = await autenticar({ login, senha: SENHA, ip: null }, { cliente: app, agora: () => AGORA });
  if (!r.ok) throw new Error('login falhou');
  const ctx = await criarProvedorContexto({
    cliente: app,
    agora: () => AGORA,
    lerCookie: async (nome) => (nome === 'sgo_unidade' ? cookieUnidade : r.token),
    lerCabecalho: async () => null,
  }).obter();
  if (!ctx) throw new Error('sem contexto');
  return ctx;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  const criar = (codigo: string, ativo = true) => migrator.unidade.create({ data: { codigo, nome: `TP ${codigo}`, ativo } }).then((u) => u.id);
  unidades = { a: await criar('TP-A'), b: await criar('TP-B'), inativa: await criar('TP-X', false) };
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('carregarTelaPrincipal', () => {
  it('administrador: menu com Usuários, nome, data do acesso e unidades ativas', async () => {
    const ctx = await logado('ana', 'ADMINISTRADOR', [unidades.a, unidades.b, unidades.inativa]);
    const t = await carregarTelaPrincipal(ctx, { cliente: app });
    expect(t.menu.map((m) => m.codigo)).toEqual(['ADMINISTRACAO']);
    expect(t.usuario).toEqual({ nome: 'Nome ana', acessoEm: AGORA.toISOString() });
    expect(t.unidades.map((u) => u.codigo)).toEqual(['TP-A', 'TP-B']);
    expect(t.unidadeAtiva).toBeNull();
  });

  it('orçamentista sem funcionalidade: menu vazio (RN0521)', async () => {
    const ctx = await logado('bia', 'ORCAMENTISTA', []);
    expect((await carregarTelaPrincipal(ctx, { cliente: app })).menu).toEqual([]);
  });

  it('funcionalidade desativada pelo Administrador some do menu', async () => {
    const ctx = await logado('caio', 'ADMINISTRADOR', []);
    await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: false } });
    try {
      expect((await carregarTelaPrincipal(ctx, { cliente: app })).menu).toEqual([]);
    } finally {
      await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: true } });
    }
  });
});

describe('unidade ativa no contexto', () => {
  it('uma só unidade vira a ativa', async () => expect((await logado('dani', 'ORCAMENTISTA', [unidades.a])).unidadeId).toBe(unidades.a));
  it('cookie dentro da lista → ativa', async () =>
    expect((await logado('edu', 'ORCAMENTISTA', [unidades.a, unidades.b], unidades.b)).unidadeId).toBe(unidades.b));
  it('cookie fora da lista → nula', async () =>
    expect((await logado('fabi', 'ORCAMENTISTA', [unidades.a, unidades.b], unidades.inativa)).unidadeId).toBeNull());
});

describe('validarTrocaUnidade', () => {
  it('aceita unidade da lista', async () => {
    const ctx = await logado('gil', 'ORCAMENTISTA', [unidades.a, unidades.b]);
    await expect(validarTrocaUnidade(ctx, unidades.b, { cliente: app })).resolves.toBeUndefined();
  });
  it('recusa unidade fora da lista ou inativa com ErroPermissao (negação auditada pela guarda)', async () => {
    const ctx = await logado('hugo', 'ORCAMENTISTA', [unidades.a, unidades.inativa]);
    await expect(validarTrocaUnidade(ctx, unidades.b, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(validarTrocaUnidade(ctx, unidades.inativa, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });
});
