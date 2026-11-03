import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedCad } from './seed';
import { seedDadosReferenciaCad } from './seed-referencia';

// Seeds do cad (plano do P4, Task 4c; R15 e R25), com o migrator, como no prisma/seed.ts.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let cliente: ReturnType<typeof criarPrisma>;

const TABELAS = ['funcionalidade', 'perfil_permissao', 'permissao_padrao_aplicada', 'conta_contabil', 'carga_estrutura', 'historico_operacao', 'cargo'];

// Retrato ordenado do conteúdo (não só da contagem): pega UPDATE indevido na segunda execução.
async function retrato(): Promise<Record<string, unknown[]>> {
  const r: Record<string, unknown[]> = {};
  for (const t of TABELAS) r[t] = await cliente.$queryRawUnsafe(`SELECT to_jsonb(x) AS l FROM ${t} x ORDER BY to_jsonb(x)::text`);
  return r;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  cliente = criarPrisma(banco.urlMigrator);
  await executarSeeds(cliente, [seedAdm]);
}, 180_000);

afterAll(async () => {
  await cliente?.$disconnect();
  await banco?.parar();
});

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('seedCad', () => {
  it('instala cad.plano_contas com os perfis do plano; duas vezes → retrato idêntico', async () => {
    await executarSeeds(cliente, [seedCad]);
    const antes = await retrato();
    await executarSeeds(cliente, [seedCad]);
    expect(await retrato()).toEqual(antes);
    const perms = await cliente.$queryRaw<{ perfil: string; acao: string }[]>`
      SELECT p.codigo AS perfil, pp.acao FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id
      WHERE pp.funcionalidade_codigo = 'cad.plano_contas' ORDER BY 1, 2`;
    expect(perms.map((x) => `${x.perfil}:${x.acao}`)).toEqual([
      'ANALISTA_GRH:consultar',
      'AUDITOR:consultar',
      'DIREX:consultar',
      'GESTOR_DIRETORIA:consultar',
      'GFIN:consultar',
      'GFIN:executar',
      'OPERADOR_VIAGENS:consultar',
      'ORCAMENTISTA:consultar',
    ]);
  });
});

describe('seedDadosReferenciaCad', () => {
  it.each([[undefined], ['0'], ['true']])('CARGA_DADOS_REFERENCIA=%s → não faz nada', async (valor) => {
    if (valor !== undefined) vi.stubEnv('CARGA_DADOS_REFERENCIA', valor);
    const antes = await retrato();
    await executarSeeds(cliente, [seedDadosReferenciaCad]);
    expect(await retrato()).toEqual(antes);
  });

  it('AMBIENTE=producao sem a carga → não faz nada, sem erro (caminho normal de prod)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AMBIENTE', 'producao');
    const antes = await retrato();
    await executarSeeds(cliente, [seedDadosReferenciaCad]);
    expect(await retrato()).toEqual(antes);
  });

  it('AMBIENTE=producao com a carga → erro (R15), sem gravar nada', async () => {
    vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
    vi.stubEnv('AMBIENTE', 'producao');
    await expect(executarSeeds(cliente, [seedDadosReferenciaCad])).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'CARGA_DADOS_REFERENCIA não pode ser usada em produção (R15)' }),
    });
    expect(await cliente.contaContabil.count()).toBe(0);
  });

  it('NODE_ENV=production sem AMBIENTE → erro (R25)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AMBIENTE', '');
    await expect(executarSeeds(cliente, [seedDadosReferenciaCad])).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('[AMBIENTE_AUSENTE]') }),
    });
  });

  it('CARGA_DADOS_REFERENCIA=1 em AMBIENTE=dev sem NODE_ENV → 174 contas, auditoria "Sistema"; a segunda vez não grava nada', async () => {
    vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
    vi.stubEnv('AMBIENTE', 'dev');
    vi.stubEnv('NODE_ENV', undefined);
    await executarSeeds(cliente, [seedDadosReferenciaCad]);
    expect(await cliente.contaContabil.count({ where: { ativa: true } })).toBe(174);
    const h = await cliente.$queryRaw<{ rotulo: string; origem: string; n: number }[]>`
      SELECT usuario_rotulo AS rotulo, origem::text AS origem, count(*)::int AS n FROM historico_operacao
      WHERE funcionalidade = 'cad.plano_contas' GROUP BY 1, 2`;
    expect(h).toEqual([{ rotulo: 'Sistema', origem: 'SISTEMA', n: 174 }]);
    expect(await cliente.cargaEstrutura.findMany({ select: { tipo: true, situacao: true, incluidas: true }, orderBy: { tipo: 'asc' } })).toEqual([
      { tipo: 'PLANO_CONTAS', situacao: 'CONCLUIDA', incluidas: 174 },
      { tipo: 'CENTROS_CUSTO', situacao: 'CONCLUIDA', incluidas: 35 },
      // Cargos sintéticos (Task 12a, P3), sem salário.
      { tipo: 'CARGOS', situacao: 'CONCLUIDA', incluidas: 8 },
    ]);
    const antes = await retrato();
    await executarSeeds(cliente, [seedDadosReferenciaCad]);
    expect(await retrato()).toEqual(antes);
  });

  it('depois da carga, produção com a carga continua recusada e nada muda', async () => {
    vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
    vi.stubEnv('AMBIENTE', 'producao');
    const antes = await retrato();
    await expect(executarSeeds(cliente, [seedDadosReferenciaCad])).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'CARGA_DADOS_REFERENCIA não pode ser usada em produção (R15)' }),
    });
    expect(await retrato()).toEqual(antes);
  });

  it('2027 já existente sem Tabela Mestre ganha os 7 itens, com a versão do ano e o Histórico', async () => {
    await cliente.$executeRawUnsafe(`DELETE FROM beneficio_mestre WHERE ano = 2027`);
    const antes = (await cliente.parametrosExercicio.findUnique({ where: { ano: 2027 } }))!.versao;
    await executarSeeds(cliente, [seedCad]);
    expect(await cliente.beneficioMestre.count({ where: { ano: 2027 } })).toBe(7);
    expect((await cliente.parametrosExercicio.findUnique({ where: { ano: 2027 } }))!.versao).toBe(antes + 1);
    expect(await cliente.historicoOperacao.count({ where: { funcionalidade: 'cad.beneficios', descricao: { contains: 'Tabela Mestre de 2027' } } })).toBe(1);
  });
});
