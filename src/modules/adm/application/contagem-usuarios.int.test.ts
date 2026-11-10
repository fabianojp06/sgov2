import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedAdm } from '../infrastructure/seed';
import { contarUsuariosPorPerfil } from './contagem-usuarios';

// Contrato para a conferência da carga do rel (#137): só contagens; os perfis padrão na ordem do
// catálogo e depois os criados pela tela, por nome.
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
  // Perfis criados pela tela (US-037, código P_…): nomes fora da ordem de código, com acento e caixa.
  await migrator.perfil.createMany({
    data: [
      { codigo: 'P_000000000001', nome: 'Zeladoria', descricao: 'Criado pela tela' },
      { codigo: 'P_000000000002', nome: 'Água e Saneamento', descricao: 'Criado pela tela' },
      { codigo: 'P_000000000003', nome: 'ética', descricao: 'Criado pela tela', ativo: false },
    ],
  });
  await usuario('tela.um', ['P_000000000001']);
  await usuario('tela.bloq', ['P_000000000001'], { bloqueado: true });
  await usuario('tela.inativo', ['P_000000000003'], { ativo: false });
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
    expect(r.trocaSenhaPendente).toBe(1);
    expect(JSON.stringify(r)).not.toContain('gfin.');
  });

  it('todos os perfis: os padrão na ordem do catálogo, depois os da tela por nome (pt-BR), com os mesmos campos', async () => {
    const r = await app.$transaction((tx) => contarUsuariosPorPerfil(tx));
    expect(r.perfis.map((p) => p.codigo)).toEqual([
      'ADMINISTRADOR',
      'ORCAMENTISTA',
      'GFIN',
      'ANALISTA_GRH',
      'OPERADOR_VIAGENS',
      'AUDITOR',
      'GESTOR_DIRETORIA',
      'DIREX',
      'P_000000000002',
      'P_000000000003',
      'P_000000000001',
    ]);
    expect(r.perfis.slice(-3)).toEqual([
      { codigo: 'P_000000000002', nome: 'Água e Saneamento', ativo: true, ativos: 0, bloqueados: 0 },
      { codigo: 'P_000000000003', nome: 'ética', ativo: false, ativos: 0, bloqueados: 0 },
      { codigo: 'P_000000000001', nome: 'Zeladoria', ativo: true, ativos: 2, bloqueados: 1 },
    ]);
    expect(r.perfis.slice(0, 8).every((p) => p.ativo)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('tela.');
  });
});
