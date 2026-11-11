import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { seedCad, seedDadosReferenciaCad } from '@/modules/cad/servidor';
import { criarExercicio, importarPlanilha } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { gerarOrcamentoSintetico, montarArquivo } from '../../../../ops/carga/orcamento-sintetico';

// Base de referência da D-P7-3 (plano do P7, Task 3, Step 1) num Postgres real (Testcontainers, D12):
// os 5 exercícios gerados por ops/carga/gerar-orcamento.ts entram pela importação de verdade do orc
// (contrato do #398), sobre o plano oficial e a minuta de CC da seed de referência, com o C1 e o C2
// reais. O tempo de cada importação (com o recálculo) vai para o log ([CARGA_ORCAMENTO]).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
const ANOS = [2027, 2028, 2029, 2030, 2031];

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const GFIN: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set([
    ['orc.exercicios', 'incluir'],
    ['orc.importacao', 'executar'],
  ].map((p) => p.join(':'))),
};
// Escopo TOTAL (sem CC de escopo), como a GFIN: as receitas exigem.
const deps = () => ({ cliente: app, obterEscopo: async () => null });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  const antes = process.env.CARGA_DADOS_REFERENCIA;
  process.env.CARGA_DADOS_REFERENCIA = '1';
  try {
    await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  } finally {
    if (antes === undefined) delete process.env.CARGA_DADOS_REFERENCIA;
    else process.env.CARGA_DADOS_REFERENCIA = antes;
    await m.$disconnect();
  }
  app = criarPrisma(banco.urlApp);
}, 180_000);

afterAll(async () => {
  await app?.$disconnect();
  await banco?.parar();
});

describe('orçamento sintético pela importação real do orc', () => {
  it.each(ANOS)('%i: o exercício novo recebe as 216 posições, os 675 pacotes e as 5 receitas', async (ano) => {
    const criado = await criarExercicio(GFIN, { ano, forma: 'EM_BRANCO' }, deps());
    expect(criado.ok, JSON.stringify(criado)).toBe(true);
    const exercicioId = (await app.orcamentoExercicio.findUniqueOrThrow({ where: { ano }, select: { id: true } })).id;
    const conteudo = await montarArquivo(gerarOrcamentoSintetico(ano));
    const inicio = performance.now();
    const r = await importarPlanilha(GFIN, { exercicioId, arquivo: { nome: `orcamento-adm-central-${ano}.xlsx`, conteudo } }, deps());
    const ms = performance.now() - inicio;
    expect(r.ok, JSON.stringify(r).slice(0, 2000)).toBe(true);
    expect(r.ok && r.valor).toMatchObject({ posicoes: 216, pacotes: 675, receitas: 5, ccs: 27 });
    expect(await app.linhaOrcada.count({ where: { exercicioId } })).toBeGreaterThan(0);
    console.log(`[CARGA_ORCAMENTO] ${ano}: importação com recálculo em ${ms.toFixed(0)} ms`);
  }, 120_000);
});
