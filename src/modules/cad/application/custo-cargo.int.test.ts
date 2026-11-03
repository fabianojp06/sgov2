import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { criarCifraSalarios } from '../infrastructure/cifra-salarios';
import { CHAVE_TESTE_CIFRA, ID_CHAVE_TESTE } from '../infrastructure/cifra-teste';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { calcularCustoCargo, MSG_SEM_FONTE, paraTelaCusto } from './custo-cargo';

// US-051 parte 2 (plano do P4, Task 14, Step 1): custo de 1 pessoa do cargo pelo MotorCustoPessoal,
// num Postgres real (Testcontainers, D12). Encargo de 51% do seed (conferido à mão na Task 11).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
const cargos: Record<string, string> = {};
const cifra = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: CHAVE_TESTE_CIFRA, CHAVE_CIFRA_SALARIOS_ID: ID_CHAVE_TESTE });

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'grh', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const grh = () => ctx(['cad.cargos', 'consultar'], ['cad.salarios', 'consultar']);
const orcamentista = () => ctx(['cad.cargos', 'consultar']);
const consultas = async (codigo: string) =>
  Number((await migrator.query(`SELECT count(*) FROM historico_operacao WHERE funcionalidade = 'cad.salarios' AND tipo_operacao = 'CONSULTA' AND registro_id = $1`, [codigo])).rows[0].count);

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
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GRH', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
  usuarioId = rows[0].id;
  // P1: Fonte Ativa (mínimo de mercado) 5.000,00 com periculosidade.
  cargos.P1 = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, mercado_minimo, mercado_maximo, fonte_ativa, adicional_tipo) VALUES ('P1', 'P1', 5000, 6000, 'MINIMO', 'PERICULOSIDADE') RETURNING id`)).rows[0].id;
  // R1: salário real cifrado de 5.000,00, sem adicional.
  cargos.R1 = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado, fonte_ativa) VALUES ('R1', 'R1', $1, 'REAL') RETURNING id`, [cifra.cifrar(Dinheiro.de('5000.00'), { codigoCargo: 'R1', campo: 'salario_real' })])).rows[0].id;
  // X1: envelope de outro cargo (AAD não confere) → ilegível.
  cargos.X1 = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, salario_real_cifrado, fonte_ativa) VALUES ('X1', 'X1', $1, 'REAL') RETURNING id`, [cifra.cifrar(Dinheiro.de('5000.00'), { codigoCargo: 'R1', campo: 'salario_real' })])).rows[0].id;
  cargos.S1 = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial) VALUES ('S1', 'S1') RETURNING id`)).rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('custo do cargo (US-051 parte 2)', () => {
  it('Fonte Ativa 5.000,00 + periculosidade: mês 1 com salário 5.000,00 e adicional 1.500,00; encargo de 51% sobre 6.500,00 (REQ_CAR_013)', async () => {
    const antes = await consultas('P1');
    const r = await calcularCustoCargo(grh(), cargos.P1!, 2027, { cliente: app, cifra });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    const mes1 = (c: string) => r.valor.serie!.linhas.find((l) => l.componente === c)?.meses[0]?.paraString();
    expect(mes1('salario')).toBe('5000.00');
    expect(mes1('adicional')).toBe('1500.00');
    expect(r.valor.base!.paraString()).toBe('6500.00');
    expect(r.valor.encargo!.total.paraString()).toBe('3315.00');
    const t = paraTelaCusto(r);
    expect(t).toMatchObject({ mascarado: false, base: '6500.00', encargoTotal: '3315.00', percentualTotal: '51,00%' });
    if (!('componentes' in t)) throw new Error('sem componentes');
    expect(t.componentes.map((c) => c.valor)).toEqual(expect.arrayContaining(['2470.00', '520.00', '65.00', '247.00', '13.00']));
    // A soma das linhas do mês 1 é o total do mês (sem drift).
    expect(t.linhasMes1.reduce((s, l) => s.somar(Dinheiro.de(l.valor)), Dinheiro.zero()).paraString()).toBe(t.totalMes1);
    expect(await consultas('P1')).toBe(antes + 1);
  });

  it('Fonte Ativa real: decifra só o salário real; envelope ilegível vira mensagem, não erro', async () => {
    const r = await calcularCustoCargo(grh(), cargos.R1!, 2027, { cliente: app, cifra });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.valor.base!.paraString()).toBe('5000.00');
    expect(r.valor.encargo!.total.paraString()).toBe('2550.00');
    const x = await calcularCustoCargo(grh(), cargos.X1!, 2027, { cliente: app, cifra });
    expect(x.ok).toBe(false);
    // I9: a mensagem da cifra, sem nenhum valor.
    expect(paraTelaCusto(x)).toEqual({ mascarado: false, erro: 'Não foi possível decifrar um salário do cargo.' });
    expect(await consultas('X1')).toBe(0);
  });

  it('benefícios do cargo (Task 13): o padrão desativado sai, o ativado no cargo entra com o valor manual; o padrão sem valor vira aviso', async () => {
    const e1 = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial, mercado_minimo, fonte_ativa) VALUES ('E1', 'E1', 5000, 'MINIMO') RETURNING id`)).rows[0].id;
    await migrator.query(`UPDATE beneficio_mestre SET valor = 600 WHERE ano = 2027 AND codigo = 'beneficio.saude_basico'`);
    await migrator.query(
      `INSERT INTO beneficio_cargo (cargo_id, ano, codigo, ativo, valor_manual, origem) VALUES ($1, 2027, 'beneficio.vr', false, NULL, 'MESTRE'), ($1, 2027, 'beneficio.odonto', true, 80, 'MANUAL')`,
      [e1],
    );
    const r = await calcularCustoCargo(grh(), e1, 2027, { cliente: app, cifra });
    const t = paraTelaCusto(r);
    if (!('linhasMes1' in t)) throw new Error(JSON.stringify(t));
    const beneficios = t.linhasMes1.filter((l) => l.componente.startsWith('beneficio.')).map((l) => [l.nome, l.valor]);
    expect(beneficios).toEqual(expect.arrayContaining([['Seguro saúde (básico)', '600.00'], ['Plano odontológico', '80.00']]));
    expect(beneficios).toHaveLength(2);
    expect(t.avisos).toEqual(['O benefício Seguro de vida é padrão da posição, mas está sem valor na Tabela Mestre de 2027.']);
    // O encargo do cargo não muda com os benefícios (UC03.19 §6.1).
    expect(t.encargoTotal).toBe('2550.00');
  });

  it('sem Fonte Ativa → mensagem; ano sem parâmetros → mensagem', async () => {
    expect(await calcularCustoCargo(grh(), cargos.S1!, 2027, { cliente: app, cifra })).toEqual({ ok: false, erros: [{ campo: 'fonteAtiva', mensagem: MSG_SEM_FONTE }] });
    expect(await calcularCustoCargo(grh(), cargos.P1!, 2099, { cliente: app, cifra })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'O exercício 2099 não tem parâmetros.' }] });
  });

  it('ORCAMENTISTA (sem cad.salarios): série e encargo nulos, sem Histórico; sem cad.cargos, recusa', async () => {
    const antes = await consultas('P1');
    const r = await calcularCustoCargo(orcamentista(), cargos.P1!, 2027, { cliente: app, cifra });
    expect(r).toEqual({ ok: true, valor: { serie: null, encargo: null, base: null, encargos: [], nomes: new Map(), avisos: [], mascarado: true } });
    expect(paraTelaCusto(r)).toEqual({ mascarado: true });
    expect(await consultas('P1')).toBe(antes);
    await expect(calcularCustoCargo(ctx(['cad.salarios', 'consultar']), cargos.P1!, 2027, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });
});
