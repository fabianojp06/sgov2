import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedOrc } from './seed';

// Seed do orc (contrato C6; plano do P6, Task 1): 5 funcionalidades no menu Administração Central.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let cliente: ReturnType<typeof criarPrisma>;

const permissoes = (perfil: string) =>
  cliente.$queryRaw<{ f: string }[]>`
    SELECT pp.funcionalidade_codigo || ':' || pp.acao AS f FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id
    WHERE p.codigo = ${perfil} AND pp.funcionalidade_codigo LIKE 'orc.%' ORDER BY 1`.then((l) => l.map((x) => x.f));

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  cliente = criarPrisma(banco.urlMigrator);
  await executarSeeds(cliente, [seedAdm, seedOrc]);
});

afterAll(async () => {
  try {
    await cliente?.$disconnect();
  } finally {
    await banco?.parar();
  }
});

describe('seedOrc', () => {
  it('5 funcionalidades no módulo ADM_CENTRAL, com ajuda', async () => {
    const fs = await cliente.funcionalidade.findMany({ where: { codigo: { startsWith: 'orc.' } }, orderBy: { ordem: 'asc' } });
    expect(fs.map((f) => f.codigo)).toEqual(['orc.orcamento', 'orc.exercicios', 'orc.importacao', 'orc.receitas', 'orc.aprovacao']);
    expect(fs.every((f) => f.moduloCodigo === 'ADM_CENTRAL' && f.grupo === 'Orçamento da Adm. Central')).toBe(true);
    expect(fs.every((f) => (f.ajuda ?? '').trim().length > 0)).toBe(true);
  });

  it('perfis padrão da tabela da Task 1 (D-P6-4, D-P6-6)', async () => {
    expect(await permissoes('GFIN')).toEqual([
      'orc.aprovacao:consultar', 'orc.aprovacao:executar',
      'orc.exercicios:alterar', 'orc.exercicios:consultar', 'orc.exercicios:incluir',
      'orc.importacao:consultar', 'orc.importacao:executar',
      'orc.orcamento:alterar', 'orc.orcamento:consultar',
      'orc.receitas:alterar', 'orc.receitas:consultar', 'orc.receitas:excluir', 'orc.receitas:incluir',
    ]);
    expect(await permissoes('DIREX')).toEqual([
      'orc.aprovacao:aprovar', 'orc.aprovacao:consultar', 'orc.exercicios:consultar', 'orc.orcamento:consultar', 'orc.receitas:consultar',
    ]);
    expect(await permissoes('AUDITOR')).toEqual([
      'orc.aprovacao:consultar', 'orc.exercicios:consultar', 'orc.orcamento:consultar', 'orc.receitas:consultar',
    ]);
    expect(await permissoes('GESTOR_DIRETORIA')).toEqual(['orc.orcamento:consultar']);
    for (const perfil of ['ADMINISTRADOR', 'ORCAMENTISTA', 'ANALISTA_GRH', 'OPERADOR_VIAGENS']) {
      expect(await permissoes(perfil)).toEqual([]);
    }
  });

  it('segunda execução não muda nada', async () => {
    const antes = await cliente.$queryRawUnsafe(`SELECT count(*)::int AS n FROM historico_operacao`);
    await executarSeeds(cliente, [seedAdm, seedOrc]);
    expect(await cliente.$queryRawUnsafe(`SELECT count(*)::int AS n FROM historico_operacao`)).toEqual(antes);
  });
});
