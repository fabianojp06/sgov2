import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedAdm } from '../infrastructure/seed';
import { contarUsuariosPorPerfil } from './contagem-usuarios';

// Contrato para a conferência da carga do rel (#137): só contagens, na ordem do catálogo.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

async function usuario(login: string, perfis: string[], extra: Record<string, unknown> = {}) {
  const ids = await migrator.perfil.findMany({ where: { codigo: { in: perfis } }, select: { id: true } });
  await migrator.usuario.create({
    data: { nome: login, email: `${login}@example.org`, login, loginNormalizado: login, senhaHash: 'x', trocaSenhaObrigatoria: false, perfis: { create: ids.map((p) => ({ perfilId: p.id })) }, ...extra },
  });
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  await usuario('gfin.um', ['GFIN']);
  await usuario('gfin.dois', ['GFIN', 'AUDITOR'], { trocaSenhaObrigatoria: true });
  await usuario('gfin.bloq', ['GFIN'], { bloqueado: true });
  await usuario('gfin.inativo', ['GFIN'], { ativo: false, trocaSenhaObrigatoria: true });
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('contarUsuariosPorPerfil', () => {
  it('ativos (com os bloqueados), bloqueados, dois perfis contam nos dois, inativo fora; troca pendente só dos ativos', async () => {
    const r = await app.$transaction((tx) => contarUsuariosPorPerfil(tx));
    const por = Object.fromEntries(r.perfis.map((p) => [p.codigo, p]));
    expect(por.GFIN).toMatchObject({ ativos: 3, bloqueados: 1 });
    expect(por.AUDITOR).toMatchObject({ ativos: 1, bloqueados: 0 });
    expect(por.DIREX).toMatchObject({ ativos: 0, bloqueados: 0 });
    expect(r.perfis.map((p) => p.codigo)).toEqual(['ADMINISTRADOR', 'ORCAMENTISTA', 'GFIN', 'ANALISTA_GRH', 'OPERADOR_VIAGENS', 'AUDITOR', 'GESTOR_DIRETORIA', 'DIREX']);
    expect(r.perfis.every((p) => p.ativo)).toBe(true);
    expect(r.trocaSenhaPendente).toBe(1);
    expect(JSON.stringify(r)).not.toContain('gfin.');
  });
});
