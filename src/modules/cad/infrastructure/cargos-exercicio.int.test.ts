import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { beneficiosDoCargo, listarCargosExercicio } from './cargos-exercicio';
import { criarCifraSalarios } from './cifra-salarios';
import { CHAVE_TESTE_CIFRA, ID_CHAVE_TESTE } from './cifra-teste';
import { seedCad } from './seed';
import { seedDadosReferenciaCad } from './seed-referencia';
import { garantirPremissasExercicio } from './premissas';

// C2, acréscimo de C&S (#138, 11/11), num Postgres real (Testcontainers, D12): cargos com o salário da
// Fonte Ativa decifrado, a faixa de mercado e os benefícios do cargo no exercício.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
const ids: Record<string, string> = {};
const cifra = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  vi.stubEnv('CARGA_DADOS_REFERENCIA', '1');
  vi.stubEnv('AMBIENTE', 'dev');
  await executarSeeds(m, [seedAdm, seedCad, seedDadosReferenciaCad]);
  // Premissas de 2027 (os benefícios do cargo saem delas).
  const sistema = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };
  await executarSeeds(m, [{ nome: 'premissas-2027', executar: async (tx) => void (await garantirPremissasExercicio(tx, sistema, 2027)) }]);
  vi.unstubAllEnvs();
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  // Os itens de referência da Tabela Mestre vêm sem valor: com valor, entram nas premissas.
  await migrator.query(`UPDATE beneficio_mestre SET valor = 100 WHERE ano = 2027 AND forma <> 'PERCENTUAL_SALARIO'`);
  await migrator.query(`UPDATE beneficio_mestre SET percentual = 1 WHERE ano = 2027 AND forma = 'PERCENTUAL_SALARIO'`);
  // Apaga os cargos sintéticos da seed: o teste controla a lista.
  await migrator.query(`UPDATE cargo SET ativo = false`);
  const inserir = async (codigo: string, sql: string, params: unknown[] = []) =>
    (ids[codigo] = (await migrator.query(sql.replace('$CODIGO', `'${codigo}'`), params)).rows[0].id);
  // Z1: mínimo de mercado, com faixa e periculosidade, nome de mercado.
  await inserir('ZZ1', `INSERT INTO cargo (codigo, nome_oficial, nome_mercado, mercado_minimo, mercado_maximo, fonte_ativa, adicional_tipo) VALUES ($CODIGO, 'Oficial 1', 'Analista', 5000, 6000, 'MINIMO', 'PERICULOSIDADE') RETURNING id`);
  // Z2: salário real cifrado, insalubridade média, sem faixa.
  await inserir('ZZ2', `INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado, fonte_ativa, adicional_tipo, adicional_grau) VALUES ($CODIGO, 'Técnico', $1, 'REAL', 'INSALUBRIDADE', 'MEDIO') RETURNING id`, [
    cifra.cifrar(Dinheiro.de('4200.00'), { codigoCargo: 'ZZ2', campo: 'salario_real' }),
  ]);
  // Z3: envelope de outro cargo (ilegível): sem salário, sem derrubar a lista.
  await inserir('ZZ3', `INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado, fonte_ativa) VALUES ($CODIGO, 'Ilegível', $1, 'REAL') RETURNING id`, [
    cifra.cifrar(Dinheiro.de('4200.00'), { codigoCargo: 'ZZ2', campo: 'salario_real' }),
  ]);
  // Z4: sem Fonte Ativa; Z5: inativo.
  await inserir('ZZ4', `INSERT INTO cargo (codigo, nome_oficial) VALUES ($CODIGO, 'Sem fonte') RETURNING id`);
  await inserir('ZZ5', `INSERT INTO cargo (codigo, nome_oficial, mercado_minimo, mercado_maximo, fonte_ativa, ativo) VALUES ($CODIGO, 'Extinto', 3000, 3500, 'MAXIMO', false) RETURNING id`);
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('listarCargosExercicio', () => {
  it('só os ativos, em ordem de código, com o salário da Fonte Ativa decifrado, a faixa e o adicional', async () => {
    const lista = await listarCargosExercicio(app, { cifra });
    expect(lista.map((c) => c.codigo)).toEqual(['ZZ1', 'ZZ2', 'ZZ3', 'ZZ4']);
    const [z1, z2, z3, z4] = lista;
    expect(z1).toMatchObject({ id: ids.ZZ1, nome: 'Analista', ativo: true, fonteAtiva: 'MINIMO', adicional: { tipo: 'PERICULOSIDADE' } });
    expect([z1!.salarioFonteAtiva?.paraString(), z1!.faixa?.minimo.paraString(), z1!.faixa?.maximo.paraString()]).toEqual(['5000.00', '5000.00', '6000.00']);
    expect(z2).toMatchObject({ nome: 'Técnico', fonteAtiva: 'REAL', faixa: null, adicional: { tipo: 'INSALUBRIDADE', grau: 'MEDIO' } });
    expect(z2!.salarioFonteAtiva?.paraString()).toBe('4200.00');
    expect(z3).toMatchObject({ fonteAtiva: 'REAL', salarioFonteAtiva: null });
    expect(z4).toMatchObject({ fonteAtiva: null, salarioFonteAtiva: null, faixa: null, adicional: null });
  });

  it('incluirInativos: também os inativos, com ativo = false', async () => {
    const lista = await listarCargosExercicio(app, { cifra, incluirInativos: true });
    expect(lista.find((c) => c.codigo === 'ZZ5')).toMatchObject({ ativo: false, fonteAtiva: 'MAXIMO' });
    expect(lista.find((c) => c.codigo === 'ZZ5')!.salarioFonteAtiva?.paraString()).toBe('3500.00');
  });
});

describe('beneficiosDoCargo', () => {
  it('sem escolha própria, os padrão da Tabela Mestre do ano; ano sem parâmetros, nada', async () => {
    const padrao = await beneficiosDoCargo(app, 2027, ids.ZZ1!);
    const { rows } = await migrator.query(`SELECT count(*)::int AS n FROM beneficio_mestre WHERE ano = 2027 AND ativo AND padrao_posicao`);
    expect(rows[0].n).toBeGreaterThan(0);
    expect(padrao).toHaveLength(rows[0].n);
    expect(padrao.every((b) => b.componente.startsWith('beneficio.'))).toBe(true);
    expect(await beneficiosDoCargo(app, 2099, ids.ZZ1!)).toEqual([]);
  });

  it('a escolha do cargo vale: o benefício desligado no cargo sai, só para ele', async () => {
    const [primeiro] = (await migrator.query(`SELECT codigo FROM beneficio_mestre WHERE ano = 2027 AND ativo AND padrao_posicao ORDER BY codigo LIMIT 1`)).rows;
    await migrator.query(`INSERT INTO beneficio_cargo (cargo_id, ano, codigo, ativo) VALUES ($1, 2027, $2, false)`, [ids.ZZ2, primeiro.codigo]);
    const doZ2 = await beneficiosDoCargo(app, 2027, ids.ZZ2!);
    const doZ1 = await beneficiosDoCargo(app, 2027, ids.ZZ1!);
    expect(doZ2.length).toBe(doZ1.length - 1);
    expect(doZ2.some((b) => b.componente === `beneficio.${primeiro.codigo}`)).toBe(false);
  });
});
