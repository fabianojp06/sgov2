import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBancoTeste } from '../../../tests/integracao/banco';
import { criarProvedorEmbeddingsFalso } from './embeddings';

// pgvector (US-020) num Postgres real: a migration declara a extensão (já instalada pelo superusuário)
// sem falhar, e o papel do app consegue usar o tipo e o operador de distância com os vetores da porta.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: pg.Client;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = new pg.Client({ connectionString: banco.urlApp });
  await app.connect();
}, 120_000);

afterAll(async () => {
  await app?.end();
  await banco?.parar();
});

describe('pgvector', () => {
  it('a extensão está instalada depois das migrations', async () => {
    const { rows } = await app.query(`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'`);
    expect(rows[0].n).toBe(1);
  });

  it('o app calcula a distância de cosseno entre os vetores da porta', async () => {
    const [a, b] = await criarProvedorEmbeddingsFalso().gerarEmbeddings(['material de escritório', 'viagem']);
    const literal = (v: readonly number[]) => `[${v.join(',')}]`;
    const { rows } = await app.query('SELECT ($1::vector <=> $1::vector) AS zero, ($1::vector <=> $2::vector) AS d', [literal(a!), literal(b!)]);
    expect(Number(rows[0].zero)).toBeCloseTo(0, 6);
    expect(Number(rows[0].d)).toBeGreaterThan(0);
  });
});
