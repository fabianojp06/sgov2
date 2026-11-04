import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definirAcao, ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { criarPrisma } from '@/shared/db';
import { falha, ok } from '@/shared/kernel';
import { aplicarUnidades, emUnidade, filtroUnidadeAtiva } from '@/shared/unidade';
import { iniciarBancoTeste } from './banco';

// Isolamento por unidade (US-007, spec §5, C31), como sgo_app (NOBYPASSRLS), numa tabela de TP só do
// teste, criada pelo migrator com a política padrão da migration 202611041400_nucleo_app_unidades.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
const A = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const B = '1c2f7a2b-6d4a-4d3c-8f1b-4e7a2a3b5c6d';
let linhaB: string;

const ctx = (unidades: string[] | undefined, unidadeId: string | null = unidades?.[0] ?? null): ContextoRequisicao => ({
  usuarioId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  usuarioRotulo: 'tp',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(['tst.dado:consultar']),
  unidadeId,
  ...(unidades ? { unidades } : {}),
});
type Linha = { id: string; unidade_id: string; texto: string };
const ler = (tx: { $queryRaw: typeof app.$queryRaw }) => tx.$queryRaw<Linha[]>`SELECT id::text, unidade_id::text, texto FROM teste_dado_tp ORDER BY texto`;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await migrator.$executeRawUnsafe(`CREATE TABLE teste_dado_tp (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unidade_id uuid NOT NULL, texto text NOT NULL)`);
  await migrator.$executeRawUnsafe(`ALTER TABLE teste_dado_tp ENABLE ROW LEVEL SECURITY`);
  await migrator.$executeRawUnsafe(
    `CREATE POLICY teste_dado_tp_unidade ON teste_dado_tp USING (unidade_id = ANY (app_unidades())) WITH CHECK (unidade_id = ANY (app_unidades()))`,
  );
  await migrator.$executeRawUnsafe(`INSERT INTO teste_dado_tp (unidade_id, texto) VALUES ('${A}', 'a1'), ('${A}', 'a2'), ('${B}', 'b1')`);
  linhaB = (await migrator.$queryRaw<{ id: string }[]>`SELECT id::text FROM teste_dado_tp WHERE texto = 'b1'`)[0]!.id;
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('RLS por unidade (app.unidades)', () => {
  it('pelo emUnidade com a unidade A, vê só as linhas de A', async () => {
    expect((await emUnidade(ctx([A]), ler, { cliente: app })).map((l) => l.texto)).toEqual(['a1', 'a2']);
    expect((await emUnidade(ctx([A, B]), ler, { cliente: app })).map((l) => l.texto)).toEqual(['a1', 'a2', 'b1']);
  });

  it('inserir linha de B com só A → recusado pela política; UPDATE e DELETE de B não afetam nada', async () => {
    await expect(emUnidade(ctx([A]), (tx) => tx.$executeRaw`INSERT INTO teste_dado_tp (unidade_id, texto) VALUES (${B}::uuid, 'invasao')`, { cliente: app })).rejects.toThrow(
      /row-level security/,
    );
    expect(await emUnidade(ctx([A]), (tx) => tx.$executeRaw`UPDATE teste_dado_tp SET texto = 'x' WHERE id = ${linhaB}::uuid`, { cliente: app })).toBe(0);
    expect(await emUnidade(ctx([A]), (tx) => tx.$executeRaw`DELETE FROM teste_dado_tp WHERE id = ${linhaB}::uuid`, { cliente: app })).toBe(0);
    // Mover uma linha de A para B também é recusado (WITH CHECK).
    await expect(emUnidade(ctx([A]), (tx) => tx.$executeRaw`UPDATE teste_dado_tp SET unidade_id = ${B}::uuid WHERE texto = 'a1'`, { cliente: app })).rejects.toThrow(/row-level security/);
  });

  it('cliente raiz fora do emUnidade, contexto sem unidades ou com lista vazia → zero linhas', async () => {
    expect(await ler(app)).toEqual([]);
    expect(await emUnidade(ctx(undefined), ler, { cliente: app })).toEqual([]);
    expect(await emUnidade(ctx([]), ler, { cliente: app })).toEqual([]);
    // Uuid inválido na lista é descartado, sem erro de sintaxe no literal.
    expect((await emUnidade(ctx(['nao-e-uuid', A]), ler, { cliente: app })).map((l) => l.texto)).toEqual(['a1', 'a2']);
  });

  it('set_config local não vaza para a próxima transação do pool', async () => {
    await emUnidade(ctx([A, B]), ler, { cliente: app });
    for (let i = 0; i < 5; i++) expect(await app.$transaction((tx) => ler(tx))).toEqual([]);
  });

  it('aplicarUnidades dentro de um tx que já existe', async () => {
    const r = await app.$transaction(async (tx) => {
      await aplicarUnidades(tx, ctx([B]));
      return ler(tx);
    });
    expect(r.map((l) => l.texto)).toEqual(['b1']);
  });
});

describe('invasão via API e guarda da unidade ativa', () => {
  it('ação com o contexto da unidade A e o id de uma linha de B → não encontrado', async () => {
    let contexto = ctx([A]);
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async () => undefined);
    const obter = definirAcao({ funcionalidade: 'tst.dado', acao: 'consultar', entrada: z.object({ id: z.string() }) }, async (e, c) => {
      const linhas = await emUnidade(c, (tx) => tx.$queryRaw<Linha[]>`SELECT id::text, unidade_id::text, texto FROM teste_dado_tp WHERE id = ${e.id}::uuid`, { cliente: app });
      return linhas.length === 0 ? falha([{ campo: 'id', mensagem: 'Registro não encontrado' }]) : ok(linhas[0]!.texto);
    });
    expect(await obter({ id: linhaB })).toEqual({ ok: false, erros: [{ campo: 'id', mensagem: 'Registro não encontrado' }] });
    contexto = ctx([A, B]);
    expect(await obter({ id: linhaB })).toEqual({ ok: true, valor: 'b1' });
  });

  it('filtroUnidadeAtiva: com A e B e A ativa, recorta para A; sem ativa ou com ativa fora da lista → ErroPermissao', async () => {
    const c = ctx([A, B], A);
    const linhas = await emUnidade(c, (tx) => tx.$queryRaw<Linha[]>`SELECT id::text, unidade_id::text, texto FROM teste_dado_tp WHERE unidade_id = ${filtroUnidadeAtiva(c).unidadeId}::uuid ORDER BY texto`, { cliente: app });
    expect(linhas.map((l) => l.texto)).toEqual(['a1', 'a2']);
    expect(() => filtroUnidadeAtiva(ctx([A, B], null))).toThrow(ErroPermissao);
    expect(() => filtroUnidadeAtiva(ctx([A], B))).toThrow(ErroPermissao);
  });
});
