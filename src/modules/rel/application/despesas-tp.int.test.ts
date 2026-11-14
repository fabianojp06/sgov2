import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { CONTAS_EXEMPLO, type NoConta } from '@/modules/cad';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { exportarDespesasTp, MENSAGENS_DESPESAS, type PortaRealizado } from './despesas-tp';

// Demonstrativo de despesas do TP (US-096 parte 1) num Postgres real (Testcontainers, D12): a seed e a
// exportação com a EXPORTACAO no Histórico. A porta do realizado é falsa aqui (a frente A a testa com a carga real).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: PrismaClient;
let app: PrismaClient;
let usuarioId = '';

const perm = (a: string) => ['rel.despesas_tp', a].join(':');
const ctx = (acoes = ['consultar', 'exportar']): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's1', ip: null, unidadeId: null, permissoes: new Set(acoes.map(perm)) });
const TP = { numero: 'TP-3', objeto: 'Apoio à gestão', inicio: '2026-09', fim: '2028-12', versaoOficial: 2 };
const porta: PortaRealizado = {
  tps: async () => [TP],
  realizado: async () => ({
    linhas: [{ conta: '4.1.1.1.001', competencia: '2027-01', valor: Dinheiro.de('50.00') }],
    ajustes: [],
    pendencias: { quantidade: 0, valor: Dinheiro.zero() },
    atualizadoEm: null,
  }),
};
const deps = () => ({ agora: () => new Date('2027-02-10T12:00:00Z'), contas: async () => CONTAS_EXEMPLO as NoConta[], cliente: app });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedRel]);
  app = criarPrisma(banco.urlApp);
  usuarioId = (await migrator.usuario.create({ data: { nome: 'GFIN', email: 'gfin@exemplo.org', login: 'gfin', loginNormalizado: 'gfin', senhaHash: 'x' } })).id;
}, 180_000);

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('demonstrativo de despesas do TP', () => {
  it('seed: em Relatórios › Prestação de contas, para GFIN, DIREX e Auditor (consultar e exportar)', async () => {
    const f = await migrator.funcionalidade.findUniqueOrThrow({ where: { codigo: 'rel.despesas_tp' } });
    expect(f).toMatchObject({ moduloCodigo: 'RELATORIOS', rota: '/rel/despesas-tp', exibirNoMenu: true });
    const pp = await migrator.perfilPermissao.findMany({ where: { funcionalidadeCodigo: 'rel.despesas_tp', acao: 'exportar' }, select: { perfil: { select: { codigo: true } } } });
    expect(pp.map((p) => p.perfil.codigo).sort()).toEqual(['AUDITOR', 'DIREX', 'GFIN']);
  });

  it('exporta XLSX, CSV e PDF, com a EXPORTACAO no Histórico (filtros e rastreio); sem TP, recusa sem gravar', async () => {
    for (const formato of ['xlsx', 'csv', 'pdf'] as const) {
      const r = await exportarDespesasTp(ctx(), { tp: 'TP-3' }, formato, porta, deps());
      expect(r).toMatchObject({ ok: true, valor: { nome: `despesas-TP-3.${formato}` } });
    }
    expect(await exportarDespesasTp(ctx(), {}, 'xlsx', porta, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_DESPESAS.ESCOLHA_TP }] });
    const h = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'rel.despesas_tp' }, select: { tipoOperacao: true, registroId: true, depois: true } });
    expect(h).toHaveLength(3);
    expect(h[0]).toMatchObject({ tipoOperacao: 'EXPORTACAO', registroId: 'TP-3', depois: { formato: 'xlsx', filtros: expect.arrayContaining([{ rotulo: 'Período', valor: '2026-09 a 2027-02' }]) } });
    await expect(exportarDespesasTp(ctx(['consultar']), { tp: 'TP-3' }, 'xlsx', porta, deps())).rejects.toThrow();
  });
});
