import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashSenha, seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';
import { responderSair, sair } from './sair';

// Logoff (US-032, UC01.04): sessões apagadas e LOGOFF no Histórico, na mesma transação.
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
const SENHA = `Certa${Date.now()}x`;

async function logado(login: string): Promise<ContextoRequisicao> {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'ORCAMENTISTA' } });
  const u = await migrator.usuario.create({
    data: {
      nome: login,
      email: `${login}@exemplo.org`,
      login,
      loginNormalizado: login,
      senhaHash: await hashSenha(SENHA),
      trocaSenhaObrigatoria: false,
      perfis: { create: { perfilId: p.id } },
    },
  });
  const r = await autenticar({ login, senha: SENHA, ip: null }, { cliente: app });
  if (!r.ok) throw new Error('login falhou');
  const s = await migrator.sessaoUsuario.findFirstOrThrow({ where: { usuarioId: u.id } });
  return { usuarioId: u.id, usuarioRotulo: login, sessaoUid: s.sessaoUid, ip: null, permissoes: new Set(['aut.sessao:excluir']) };
}

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

describe('sair', () => {
  it('apaga as sessões do usuário e grava LOGOFF (RN0522, RN0029)', async () => {
    const ctx = await logado('ana');
    await sair(ctx, { cliente: app });
    expect(await migrator.sessaoUsuario.count({ where: { usuarioId: ctx.usuarioId } })).toBe(0);
    const h = await migrator.historicoOperacao.findMany({ where: { usuarioId: ctx.usuarioId, tipoOperacao: 'LOGOFF' } });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ funcionalidade: 'aut.sessao', sessaoUid: ctx.sessaoUid });
  });

  it('duas abas saindo juntas: um LOGOFF só', async () => {
    const ctx = await logado('dora');
    await Promise.all([sair(ctx, { cliente: app }), sair(ctx, { cliente: app })]);
    expect(await migrator.historicoOperacao.count({ where: { usuarioId: ctx.usuarioId, tipoOperacao: 'LOGOFF' } })).toBe(1);
  });

  it('falha na auditoria: a sessão continua (RNF0013)', async () => {
    const ctx = await logado('bia');
    falharAuditoria = true;
    try {
      await expect(sair(ctx, { cliente: app })).rejects.toThrow('falha simulada');
    } finally {
      falharAuditoria = false;
    }
    expect(await migrator.sessaoUsuario.count({ where: { usuarioId: ctx.usuarioId } })).toBe(1);
  });

  it('resposta da rota: 204, cookies limpos e Clear-Site-Data só com "storage"', async () => {
    const ctx = await logado('caio');
    const r = await responderSair({ cliente: app })(new Request('http://127.0.0.1:3100/aut/sair', { method: 'POST' }), ctx);
    expect(r.status).toBe(204);
    const setCookie = r.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/sgo_sessao=;.*Max-Age=0/i);
    expect(setCookie).toMatch(/sgo_unidade=;.*Max-Age=0/i);
    expect(r.headers.get('clear-site-data')).toBe('"storage"');
    expect(await migrator.sessaoUsuario.count({ where: { usuarioId: ctx.usuarioId } })).toBe(0);
  });
});
