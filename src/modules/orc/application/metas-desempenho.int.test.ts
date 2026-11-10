import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { seedCad, seedDadosReferenciaCad } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { recalcular } from './calculo-linhas';
import { obterVisaoExercicio } from './consolidacao';

// Meta do recálculo da §10.3 (≤ 2 s para 1.000 linhas analíticas) medida no servidor (plano do P7,
// Task 3; pedido da frente B na #138), no formato do cad/application/metas-desempenho.int.test.ts:
// os casos de uso inteiros (permissão, transação, trava, Histórico) num Postgres real, sem o HTTP,
// com o C1 e o C2 reais sobre a seed de referência. O "Recalcular" refaz as 1.000 linhas orçadas
// com as premissas atuais; a visão do exercício soma os sintéticos a partir delas pelo
// TotalizerService. O p95 vai para o log ([META_RECALCULO]) para registro.
const VEZES = 20;
const META_MS = 2000;
const LINHAS = 1000;
const ANO = 2027;

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
let exercicioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const gfin = () => ctx(['orc.orcamento', 'consultar'], ['orc.orcamento', 'alterar']);

const p95 = (amostras: number[]) => [...amostras].sort((a, b) => a - b)[Math.ceil(amostras.length * 0.95) - 1]!;

async function medir(nome: string, executar: () => Promise<void>): Promise<number> {
  const tempos: number[] = [];
  for (let i = 0; i < VEZES; i++) {
    const inicio = performance.now();
    await executar();
    tempos.push(performance.now() - inicio);
  }
  const resultado = p95(tempos);
  console.log(`[META_RECALCULO] ${nome}: p95 ${resultado.toFixed(0)} ms, máximo ${Math.max(...tempos).toFixed(0)} ms em ${VEZES} execuções`);
  return resultado;
}

const recalcularUmaVez = async () => {
  const r = await recalcular(gfin(), exercicioId, { cliente: app });
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor.linhas;
};

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  usuarioId = (await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`)).rows[0].id;
  exercicioId = (await migrator.query(`INSERT INTO orc_exercicio (ano) VALUES ($1) RETURNING id`, [ANO])).rows[0].id;

  // Os CCs analíticos ativos da seed de referência, em rodízio, e uma conta analítica de despesa.
  const ccs = (await migrator.query(`SELECT classificacao FROM centro_custo WHERE tipo = 'ANALITICO' AND ativo ORDER BY classificacao`)).rows.map((r) => r.classificacao as string);
  const conta = (await migrator.query(`SELECT classificacao FROM conta_contabil WHERE classificacao = '4.1.1.5.005'`)).rows[0].classificacao as string;
  const posicao = (i: number) =>
    migrator.query(`INSERT INTO orc_posicao (exercicio_id, cc, cargo, quantidade, salario_mensal, mes_inicio, mes_saida, origem) VALUES ($1, $2, 'Analista', 1, $3, 1, 12, 'IMPORTACAO')`, [
      exercicioId,
      ccs[i % ccs.length],
      (3000 + i).toFixed(2),
    ]);
  // Quantas linhas uma posição gera com o C2 real (salário, encargos, férias, 13º...): as posições
  // ocupam o que couber e os pacotes completam as 1.000 linhas analíticas.
  await posicao(0);
  const porPosicao = await recalcularUmaVez();
  const posicoes = Math.floor(LINHAS / porPosicao);
  for (let i = 1; i < posicoes; i++) await posicao(i);
  for (let i = 0; i < LINHAS - posicoes * porPosicao; i++) {
    await migrator.query(
      `INSERT INTO orc_pacote (exercicio_id, cc, conta, justificativa, prioridade, quantidade, valor_unitario, corrigir_ipca, distribuicao, origem)
       VALUES ($1, $2, $3, 'Reposição de material', 'IMPORTANTE', 12, $4, true, 'MENSAL', 'IMPORTACAO')`,
      [exercicioId, ccs[i % ccs.length], conta, (100 + i).toFixed(2)],
    );
  }
  expect(await recalcularUmaVez()).toBe(LINHAS);
}, 300_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('meta do recálculo (§10.3: até 2 s para 1.000 linhas analíticas)', () => {
  it('Recalcular o exercício: p95 dentro da meta', async () => {
    const r = await medir(`Recalcular (${LINHAS} linhas)`, async () => {
      expect(await recalcularUmaVez()).toBe(LINHAS);
    });
    expect(r).toBeLessThanOrEqual(META_MS);
  });

  it('totais da visão do exercício pelo TotalizerService: p95 dentro da meta', async () => {
    const r = await medir(`visão do exercício (${LINHAS} linhas)`, async () => {
      const v = await obterVisaoExercicio(gfin(), ANO, null, { cliente: app });
      expect(v?.arvore.length).toBeGreaterThan(0);
    });
    expect(r).toBeLessThanOrEqual(META_MS);
  });
});
