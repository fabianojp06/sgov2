import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import ccMinuta from '../infrastructure/dados/cc-minuta-rev23102026.json';
import planoOficial from '../infrastructure/dados/plano-contas-oficial.json';
import { criarCifraSalarios } from '../infrastructure/cifra-salarios';
import { CHAVE_TESTE_CIFRA, ID_CHAVE_TESTE } from '../infrastructure/cifra-teste';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { resumirCadastrosParaConferencia } from './conferencia-cadastros';

// Resumo dos cadastros da conferência da carga (plano do P7, Task 2) num Postgres real
// (Testcontainers, D12). Os totais esperados vêm dos arquivos oficiais da seed de referência, não
// de um SQL com a mesma regra do código.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
const cifra = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE });
const semChave = criarCifraSalarios({});

type Celulas = Record<string, string | null>;
const contas = (planoOficial as { celulas: Celulas }[]).map((l) => l.celulas);
const centros = (ccMinuta as { celulas: Celulas }[]).map((l) => l.celulas);

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'gfin', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const semSalarios = () => ctx(['rel.conferencia_carga', 'consultar']);
const comSalarios = () => ctx(['rel.conferencia_carga', 'consultar'], ['cad.salarios', 'consultar']);
const consultas = async () =>
  Number((await migrator.query(`SELECT count(*) FROM historico_operacao WHERE funcionalidade = 'cad.salarios' AND tipo_operacao = 'CONSULTA' AND registro_id = 'conferencia-carga-2027'`)).rows[0].count);
const comTx = <T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) => app.$transaction(fn);

let contaInativada: { nivel: number };

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

  // Salários reais: dois legíveis nos ativos (5.000,00 + 2.500,50), um ilegível (AAD de outro cargo)
  // e um num cargo inativo, que fica fora da soma.
  const env = (codigo: string, v: string) => cifra.cifrar(Dinheiro.de(v), { codigoCargo: codigo, campo: 'salario_real' });
  await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado) VALUES ('CONF1', 'C1', $1), ('CONF2', 'C2', $2), ('CONF3', 'C3', $3)`, [
    env('CONF1', '5000.00'),
    env('CONF2', '2500.50'),
    env('CONF1', '1.00'),
  ]);
  const inativo = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado, ativo) VALUES ('CONF4', 'C4', $1, false) RETURNING id`, [env('CONF4', '9999.00')])).rows[0].id;
  const ativo = (await migrator.query(`SELECT id FROM cargo WHERE codigo = 'CONF1'`)).rows[0].id;
  // Faixa ativa e benefício ativo no cargo inativo: não contam. Um item inativo da Tabela Mestre
  // com a linha do cargo ativa: também não conta.
  const pleno = (await migrator.query(`SELECT id FROM senioridade WHERE nome = 'Pleno'`)).rows[0].id;
  await migrator.query(`INSERT INTO faixa_salarial (cargo_id, senioridade_id, minimo, maximo) VALUES ($1, $3, 1000, 2000), ($2, $3, 1000, 2000)`, [ativo, inativo, pleno]);
  const itens = (await migrator.query(`SELECT codigo FROM beneficio_mestre WHERE ano = 2027 AND ativo ORDER BY codigo LIMIT 2`)).rows.map((r) => r.codigo);
  await migrator.query(`INSERT INTO beneficio_cargo (cargo_id, ano, codigo, ativo) VALUES ($1, 2027, $3, true), ($2, 2027, $3, true), ($1, 2027, $4, true)`, [ativo, inativo, itens[0], itens[1]]);
  await migrator.query(`UPDATE beneficio_mestre SET ativo = false WHERE ano = 2027 AND codigo = $1`, [itens[1]]);
  // Uma conta analítica inativada (folha, com irmãs ativas): sai das ativas e entra nas inativas.
  const folha = (
    await migrator.query(`SELECT c.id, c.nivel FROM conta_contabil c WHERE c.tipo = 'ANALITICA' AND c.ativa
      AND (SELECT count(*) FROM conta_contabil i WHERE i.pai_id = c.pai_id AND i.ativa) > 1 LIMIT 1`)
  ).rows[0];
  await migrator.query(`UPDATE conta_contabil SET ativa = false, inativada_em = now() WHERE id = $1`, [folha.id]);
  contaInativada = { nivel: folha.nivel };
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('resumo dos cadastros para a conferência (P7, Task 2)', () => {
  it('contas e CCs por nível batem com os arquivos oficiais da seed', async () => {
    const r = await comTx((tx) => resumirCadastrosParaConferencia(semSalarios(), tx, 2027, { cifra }));
    const total = (l: readonly { ativos: number; inativos: number }[]) => l.reduce((s, n) => s + n.ativos + n.inativos, 0);
    expect(total(r.contas)).toBe(contas.length);
    expect(r.contas.reduce((s, n) => s + n.analiticosAtivos, 0)).toBe(contas.filter((c) => c['Tipo'] === 'A').length - 1);
    expect(r.contas.find((n) => n.nivel === contaInativada.nivel)?.inativos).toBe(1);
    expect(r.contas.filter((n) => n.nivel !== contaInativada.nivel).every((n) => n.inativos === 0)).toBe(true);
    expect(total(r.centrosCusto)).toBe(centros.length);
    expect(r.centrosCusto.reduce((s, n) => s + n.analiticosAtivos, 0)).toBe(centros.filter((c) => c['Tipo'] === 'Analítico').length);
    expect(r.centrosCustoProvisorios).toBe(centros.length);
  });

  it('cargos, faixas e benefícios contam só o que está ativo (cargo, faixa e item da Tabela Mestre)', async () => {
    const r = await comTx((tx) => resumirCadastrosParaConferencia(semSalarios(), tx, 2027, { cifra }));
    const sinteticos = Number((await migrator.query(`SELECT count(*) FROM cargo WHERE codigo NOT LIKE 'CONF%' AND ativo`)).rows[0].count);
    expect(r.cargos).toMatchObject({ ativos: sinteticos + 3, inativos: 1, comSalarioReal: 3 });
    expect(r.faixasSalariaisAtivas).toBe(1);
    expect(r.exercicio).toMatchObject({ ano: 2027, beneficiosCargoAtivos: 1, congelado: false });
  });

  it('sem cad.salarios: nada é decifrado e não há consulta no Histórico', async () => {
    const antes = await consultas();
    const decifrar = vi.spyOn(cifra, 'decifrar');
    const r = await comTx((tx) => resumirCadastrosParaConferencia(semSalarios(), tx, 2027, { cifra }));
    expect(r.cargos.somaSalarioReal).toEqual({ situacao: 'oculta' });
    expect(decifrar).not.toHaveBeenCalled();
    decifrar.mockRestore();
    expect(await consultas()).toBe(antes);
  });

  it('com cad.salarios: soma os ativos legíveis, conta o ilegível à parte e registra a consulta sem valores', async () => {
    const antes = await consultas();
    const r = await comTx((tx) => resumirCadastrosParaConferencia(comSalarios(), tx, 2027, { cifra }));
    expect(r.cargos.somaSalarioReal).toEqual({ situacao: 'calculada', total: '7500.50', ilegiveis: 1 });
    expect(await consultas()).toBe(antes + 1);
    const { rows } = await migrator.query(`SELECT depois FROM historico_operacao WHERE registro_id = 'conferencia-carga-2027' ORDER BY id DESC LIMIT 1`);
    expect(rows[0].depois).toEqual({ ano: 2027, cargos: 2 });
  });

  it('sem a chave de cifra: soma indisponível (nunca 0,00) e sem consulta no Histórico', async () => {
    const antes = await consultas();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await comTx((tx) => resumirCadastrosParaConferencia(comSalarios(), tx, 2027, { cifra: semChave }));
    erro.mockRestore();
    expect(r.cargos.somaSalarioReal).toEqual({ situacao: 'indisponivel' });
    expect(await consultas()).toBe(antes);
  });
});
