import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrisma, tentarTravarRecurso, travarRecurso } from '@/shared/db';
import { ConflitoConcorrencia, exigirUmaLinha } from '@/shared/kernel';
import { iniciarBancoTeste } from './banco';

// Concorrência otimista e trava por recurso (US-011; spec l.276–277 e l.639), como sgo_app, numa
// tabela só do teste.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await migrator.$executeRawUnsafe(`CREATE TABLE teste_versionado (id int PRIMARY KEY, texto text NOT NULL, versao int NOT NULL DEFAULT 0)`);
  await migrator.$executeRawUnsafe(`GRANT SELECT, UPDATE ON teste_versionado TO sgo_app`);
  await migrator.$executeRawUnsafe(`INSERT INTO teste_versionado (id, texto) VALUES (1, 'original')`);
}, 120_000);

afterAll(async () => {
  await app?.$disconnect();
  await migrator?.$disconnect();
  await banco?.parar();
});

const salvar = (texto: string, versao: number) =>
  app.$transaction(async (tx) => {
    const n = await tx.$executeRaw`UPDATE teste_versionado SET texto = ${texto}, versao = versao + 1 WHERE id = 1 AND versao = ${versao}`;
    exigirUmaLinha({ count: n });
  });

describe('concorrência (US-011)', () => {
  it('dois saves com a mesma versão: um grava, o outro recebe ConflitoConcorrencia', async () => {
    const r = await Promise.allSettled([salvar('primeiro', 0), salvar('segundo', 0)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusado = r.find((x) => x.status === 'rejected');
    expect(recusado && recusado.status === 'rejected' && recusado.reason).toBeInstanceOf(ConflitoConcorrencia);
    const [linha] = await app.$queryRaw<{ versao: number }[]>`SELECT versao FROM teste_versionado WHERE id = 1`;
    expect(linha!.versao).toBe(1);
  });

  it('travarRecurso serializa a mesma chave; tentarTravarRecurso não espera', async () => {
    const ordem: string[] = [];
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const travada = new Promise<void>((r) => (travou = r));
    const primeira = app.$transaction(
      async (tx) => {
        await travarRecurso(tx, 'teste:recurso');
        travou();
        await segura;
        ordem.push('primeira');
      },
      { timeout: 20_000 },
    );
    try {
      await Promise.race([travada, primeira]);
      expect(await app.$transaction((tx) => tentarTravarRecurso(tx, 'teste:recurso'))).toBe(false);
      expect(await app.$transaction((tx) => tentarTravarRecurso(tx, 'teste:outro'))).toBe(true);
      const segunda = app.$transaction(
        async (tx) => {
          await travarRecurso(tx, 'teste:recurso');
          ordem.push('segunda');
        },
        { timeout: 20_000 },
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(ordem).toEqual([]);
      soltar();
      await Promise.all([primeira, segunda]);
      expect(ordem).toEqual(['primeira', 'segunda']);
    } finally {
      // Falha no meio não deixa a primeira transação presa até o timeout.
      soltar();
      await primeira.catch(() => undefined);
    }
  });
});
