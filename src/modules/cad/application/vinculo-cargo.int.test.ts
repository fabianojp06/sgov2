import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { listarCargos } from './cargos';
import { listarUnidadesParaVinculo, vincularCargo } from './vinculo-cargo';

// Vínculo do cargo com a estrutura funcional (US-048 parte 2), com Postgres real e o sgo_app. Os testes
// compartilham o banco e dependem da ordem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
let cargo: { id: string; codigo: string; versao: number };
const u: Record<string, string> = {};

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
const grh = () => ctx(['cad.cargos:consultar', 'cad.cargos:alterar']);
const leitor = () => ctx(['cad.cargos:consultar']);
const vinculoAtual = async () => (await migrator.query('SELECT vinculo_funcional_id AS v, versao FROM cargo WHERE id = $1', [cargo.id])).rows[0];

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
  usuarioId = (
    await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GRH', 'r@exemplo.org', 'r', 'r', 'x') RETURNING id`)
  ).rows[0].id;
  const ins = async (nome: string, tipo: string, superior: string | null) =>
    (await migrator.query('INSERT INTO unidade_funcional (nome, tipo, superior_id) VALUES ($1, $2, $3) RETURNING id', [nome, tipo, superior])).rows[0].id as string;
  u.dir = await ins('Diretoria Técnica', 'DIRETORIA', null);
  u.ger = await ins('Gerência de Operações', 'GERENCIA', u.dir);
  u.setor = await ins('Setor de Compras', 'SETOR', u.ger);
  u.coord = await ins('Coordenadoria de TI', 'COORDENADORIA', u.ger);
  cargo = (await migrator.query(`SELECT id, codigo, versao FROM cargo WHERE ativo ORDER BY codigo LIMIT 1`)).rows[0];
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('vínculo do cargo com a estrutura funcional (US-048 parte 2)', () => {
  it('sem vínculo, o cargo ativo fica "pendente de alocação"; o seletor traz só as analíticas ativas', async () => {
    const lista = await listarCargos(leitor(), { cliente: app });
    expect(lista.find((c) => c.id === cargo.id)).toMatchObject({ lotacao: null, pendenteAlocacao: true });
    const unidades = await listarUnidadesParaVinculo(leitor(), { cliente: app });
    expect(unidades.map((x) => x.rotulo)).toEqual(['Coordenadoria de TI (Gerência de Operações)', 'Setor de Compras (Gerência de Operações)']);
    // Sintéticas (Diretoria, Gerência) não aparecem.
    expect(unidades.some((x) => x.id === u.ger || x.id === u.dir)).toBe(false);
  });

  it('quem só consulta não vincula', async () => {
    await expect(vincularCargo(leitor(), cargo.id, null, u.setor!, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('vincula pelo sgo_app, sem subir a versão do cargo, com o Histórico; deixa de ser pendente', async () => {
    expect(await vincularCargo(grh(), cargo.id, null, u.setor!, { cliente: app })).toEqual({ ok: true, valor: { unidadeId: u.setor } });
    expect(await vinculoAtual()).toEqual({ v: u.setor, versao: cargo.versao });
    const h = (await migrator.query(`SELECT descricao, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.cargos' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(h).toEqual({
      descricao: `Cargo ${cargo.codigo} vinculado a Setor "Setor de Compras"`,
      antes: { vinculoFuncional: null },
      depois: { vinculoFuncional: { id: u.setor, nome: 'Setor de Compras' } },
    });
    const lista = await listarCargos(leitor(), { cliente: app });
    expect(lista.find((c) => c.id === cargo.id)).toMatchObject({ lotacao: { id: u.setor, rotulo: 'Setor de Compras', ativa: true }, pendenteAlocacao: false });
  });

  it('vínculo anterior diferente do gravado → concorrência, sem gravar', async () => {
    expect(await vincularCargo(grh(), cargo.id, null, u.coord!, { cliente: app })).toMatchObject({ ok: false, erros: [{ mensagem: expect.stringContaining('outro usuário') }] });
    expect((await vinculoAtual()).v).toBe(u.setor);
  });

  it('unidade sintética, inexistente ou id inválido é recusado', async () => {
    expect(await vincularCargo(grh(), cargo.id, u.setor!, u.ger!, { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: 'unidadeId' }] });
    expect(await vincularCargo(grh(), cargo.id, u.setor!, '00000000-0000-4000-8000-0000000000ff', { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: 'unidadeId' }] });
    expect(await vincularCargo(grh(), cargo.id, u.setor!, 'x', { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: 'unidadeId' }] });
  });

  it('troca de unidade e desvincula; desvinculado, volta a pendente', async () => {
    expect(await vincularCargo(grh(), cargo.id, u.setor!, u.coord!, { cliente: app })).toMatchObject({ ok: true });
    expect(await vincularCargo(grh(), cargo.id, u.coord!, null, { cliente: app })).toEqual({ ok: true, valor: { unidadeId: null } });
    expect((await listarCargos(leitor(), { cliente: app })).find((c) => c.id === cargo.id)).toMatchObject({ lotacao: null, pendenteAlocacao: true });
  });

  it('cargo reativado pela recarga numa unidade inativa conta como pendente (RN_EST_05)', async () => {
    // Cargo inativo vinculado; a unidade é inativada (permitido: o cargo não está ativo); a recarga reativa o cargo.
    await vincularCargo(grh(), cargo.id, null, u.coord!, { cliente: app });
    await migrator.query('UPDATE cargo SET ativo = false WHERE id = $1', [cargo.id]);
    await migrator.query('UPDATE unidade_funcional SET ativa = false WHERE id = $1', [u.coord]);
    await migrator.query('UPDATE cargo SET ativo = true WHERE id = $1', [cargo.id]);
    const c = (await listarCargos(leitor(), { cliente: app })).find((x) => x.id === cargo.id);
    expect(c).toMatchObject({ lotacao: { id: u.coord, ativa: false }, pendenteAlocacao: true });
  });
});
