import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { EntradaParametros } from '../domain/parametros';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { alterarParametrosExercicio, alterarSalarioMinimo } from './parametros';

// Meta da escrita simples da §10.3 (≤ 1,5 s) medida no servidor (plano do P7, Task 3, Step 2; US-116,
// #138): o caso de uso inteiro (permissão, transação, trava da versão do ano, Histórico) num Postgres
// real, sem o HTTP. O k6 (ops/carga) mede as páginas; aqui ficam as escritas, cujo ID de Server
// Action muda a cada build. O p95 vai para o log ([META_ESCRITA]) para registro.
const VEZES = 20;
const META_MS = 1500;

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const gfin = () => ctx(['cad.parametros', 'consultar'], ['cad.parametros', 'alterar'], ['cad.salario_minimo', 'alterar']);
const versaoAtual = async () => (await migrator.query('SELECT versao FROM parametros_exercicio WHERE ano = 2027')).rows[0].versao as number;

const entrada = (reajuste: string): EntradaParametros => ({
  reajuste,
  mesDataBase: 4,
  ipca: '4.5',
  diasUteisMes: 21,
  semaforo: { verdeAte: '70', amareloAte: '85', laranjaAte: '95' },
  encargos: [
    { componente: 'encargo.inss', percentual: '37', conta: '4.1.1.2.001' },
    { componente: 'encargo.fgts', percentual: '8', conta: '4.1.1.2.005' },
    { componente: 'encargo.pis', percentual: '1', conta: '4.1.1.2.008' },
    { componente: 'encargo.obrigacoes', percentual: '3.8', conta: '4.1.1.8.003' },
    { componente: 'encargo.riscos', percentual: '0.2', conta: '4.1.1.8.004' },
  ],
  contas: { salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' },
});

const p95 = (amostras: number[]) => [...amostras].sort((a, b) => a - b)[Math.ceil(amostras.length * 0.95) - 1]!;

// A versão vem da escrita anterior (ou é lida antes de começar): o tempo medido é só o do caso de uso.
type Escrita = { ok: true; valor: { versao: number } } | { ok: false };
async function medir(nome: string, escrever: (i: number, versao: number) => Promise<Escrita>): Promise<number> {
  const tempos: number[] = [];
  let versao = await versaoAtual();
  for (let i = 0; i < VEZES; i++) {
    const inicio = performance.now();
    const r = await escrever(i, versao);
    tempos.push(performance.now() - inicio);
    expect(r.ok, `${nome}, escrita ${i + 1}`).toBe(true);
    if (r.ok) versao = r.valor.versao;
  }
  const resultado = p95(tempos);
  console.log(`[META_ESCRITA] ${nome}: p95 ${resultado.toFixed(0)} ms, máximo ${Math.max(...tempos).toFixed(0)} ms em ${VEZES} escritas`);
  return resultado;
}

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
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('meta da escrita simples (§10.3: até 1,5 s)', () => {
  it('parâmetros do exercício: p95 dentro da meta', async () => {
    const r = await medir('parâmetros do exercício', (i, versao) =>
      alterarParametrosExercicio(gfin(), 2027, versao, entrada(i % 2 === 0 ? '6' : '6.5'), { cliente: app }),
    );
    expect(r).toBeLessThanOrEqual(META_MS);
  });

  it('salário mínimo: p95 dentro da meta', async () => {
    const r = await medir('salário mínimo', (i, versao) => alterarSalarioMinimo(gfin(), 2027, versao, i % 2 === 0 ? '1518,00' : '1520,00', { cliente: app }));
    expect(r).toBeLessThanOrEqual(META_MS);
  });
});
