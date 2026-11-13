import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { definirSituacaoUnidade, incluirUnidade, obterTelaEstruturaFuncional, renomearUnidade } from './estrutura-funcional';

// Estrutura funcional (US-048), com Postgres real, o papel sgo_app e as travas do banco. Os testes
// compartilham o banco e dependem da ordem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
const ids: Record<string, string> = {};

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
const grh = () => ctx(['cad.estrutura_funcional:consultar', 'cad.estrutura_funcional:incluir', 'cad.estrutura_funcional:alterar']);
const leitor = () => ctx(['cad.estrutura_funcional:consultar']);
const versao = async (id: string) => (await migrator.query('SELECT versao FROM unidade_funcional WHERE id = $1', [id])).rows[0].versao as number;

async function incluir(chave: string, nome: string, tipo: string, superior: string | null) {
  const r = await incluirUnidade(grh(), { nome, tipo, superiorId: superior === null ? null : ids[superior]! }, { cliente: app });
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  ids[chave] = r.valor.id;
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
  usuarioId = (
    await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GRH', 'r@exemplo.org', 'r', 'r', 'x') RETURNING id`)
  ).rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('estrutura funcional (US-048)', () => {
  it('catálogo: a GRH inclui e altera; GFIN e Auditor consultam', async () => {
    const { rows } = await migrator.query(
      `SELECT p.codigo AS perfil, pp.acao FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id
       WHERE pp.funcionalidade_codigo = 'cad.estrutura_funcional' ORDER BY 1, 2`,
    );
    expect(rows.map((r) => `${r.perfil}:${r.acao}`)).toEqual([
      'ANALISTA_GRH:alterar',
      'ANALISTA_GRH:consultar',
      'ANALISTA_GRH:incluir',
      'AUDITOR:consultar',
      'GFIN:consultar',
    ]);
  });

  it('inclui a árvore válida pelo sgo_app, com o Histórico; a tela a mostra em ordem de nome', async () => {
    await incluir('dir', 'Diretoria Técnica', 'DIRETORIA', null);
    await incluir('asse', 'Assessoria Jurídica', 'ASSESSORIA', 'dir');
    await incluir('ger', 'Gerência de Operações', 'GERENCIA', 'dir');
    await incluir('setor', 'Setor de Compras', 'SETOR', 'ger');
    await incluir('coord', 'Coordenadoria de TI', 'COORDENADORIA', 'ger');
    await incluir('gtopo', 'Gerência Avulsa', 'GERENCIA', null);
    const tela = await obterTelaEstruturaFuncional(leitor(), { cliente: app });
    expect(tela.arvore.map((n) => n.nome)).toEqual(['Diretoria Técnica', 'Gerência Avulsa']);
    expect(tela.arvore[0]!.filhos.map((n) => n.nome)).toEqual(['Assessoria Jurídica', 'Gerência de Operações']);
    expect(tela.arvore[0]!.filhos[1]!.filhos.map((n) => n.nome)).toEqual(['Coordenadoria de TI', 'Setor de Compras']);
    const h = (await migrator.query(`SELECT tipo_operacao AS tipo, descricao FROM historico_operacao WHERE funcionalidade = 'cad.estrutura_funcional' ORDER BY id LIMIT 1`)).rows[0];
    expect(h).toEqual({ tipo: 'INSERCAO', descricao: 'Diretoria "Diretoria Técnica" incluída' });
  });

  it('E1 e as outras combinações inválidas são recusadas pelo caso de uso e pelo banco', async () => {
    expect(await incluirUnidade(grh(), { nome: 'Coord direta', tipo: 'COORDENADORIA', superiorId: ids.dir! }, { cliente: app })).toMatchObject({
      ok: false,
      erros: [{ campo: 'superiorId', mensagem: expect.stringContaining('sob uma Gerência') }],
    });
    expect(await incluirUnidade(grh(), { nome: 'Abaixo do setor', tipo: 'SETOR', superiorId: ids.setor! }, { cliente: app })).toMatchObject({ ok: false });
    await expect(migrator.query(`INSERT INTO unidade_funcional (nome, tipo, superior_id) VALUES ('X', 'SETOR', $1)`, [ids.dir])).rejects.toThrow(/Vínculo hierárquico inválido/);
    await expect(migrator.query(`INSERT INTO unidade_funcional (nome, tipo) VALUES ('X', 'SETOR')`)).rejects.toThrow(/precisa de unidade superior/);
  });

  it('nome repetido entre as ativas do mesmo superior é recusado; em outro superior, aceito', async () => {
    expect(await incluirUnidade(grh(), { nome: 'setor de compras', tipo: 'SETOR', superiorId: ids.ger! }, { cliente: app })).toMatchObject({
      ok: false,
      erros: [{ campo: 'nome' }],
    });
    await incluir('ger2', 'Gerência de Apoio', 'GERENCIA', 'dir');
    await incluir('setor2', 'Setor de Compras', 'SETOR', 'ger2');
  });

  it('renomeia com a versão; versão desatualizada → concorrência', async () => {
    const v = await versao(ids.coord!);
    expect(await renomearUnidade(grh(), ids.coord!, v, 'Coordenadoria de Sistemas', { cliente: app })).toEqual({ ok: true, valor: { versao: v + 1 } });
    expect(await renomearUnidade(grh(), ids.coord!, v, 'Outro', { cliente: app })).toMatchObject({ ok: false, erros: [{ mensagem: expect.stringContaining('outro usuário') }] });
  });

  it('o tipo e o superior não mudam no banco; o app não apaga', async () => {
    await expect(migrator.query(`UPDATE unidade_funcional SET tipo = 'COORDENADORIA' WHERE id = $1`, [ids.setor])).rejects.toThrow(/não mudam/);
    await expect(app.$executeRawUnsafe(`UPDATE unidade_funcional SET superior_id = NULL WHERE id = '${ids.setor}'`)).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe(`DELETE FROM unidade_funcional WHERE id = '${ids.setor}'`)).rejects.toThrow(/permission denied/);
  });

  it('cargo só se vincula a analítica ativa (trigger); o painel de ocupação mostra o cargo', async () => {
    const cargo = (await migrator.query(`SELECT id, codigo FROM cargo WHERE ativo ORDER BY codigo LIMIT 1`)).rows[0];
    await expect(migrator.query('UPDATE cargo SET vinculo_funcional_id = $1 WHERE id = $2', [ids.ger, cargo.id])).rejects.toThrow(/analítica ativa/);
    await app.$executeRawUnsafe(`UPDATE cargo SET vinculo_funcional_id = '${ids.setor}' WHERE id = '${cargo.id}'`);
    const tela = await obterTelaEstruturaFuncional(leitor(), { cliente: app });
    expect(tela.ocupacao[ids.setor!]?.map((c) => c.codigo)).toEqual([cargo.codigo]);
  });

  it('RN_EST_04 (E3): não inativa com cargo ativo vinculado nem com unidade ativa abaixo; o banco também barra', async () => {
    const vs = await versao(ids.setor!);
    expect(await definirSituacaoUnidade(grh(), ids.setor!, vs, false, { cliente: app })).toMatchObject({ ok: false, erros: [{ mensagem: expect.stringContaining('1 cargo(s) ativo(s)') }] });
    await expect(migrator.query('UPDATE unidade_funcional SET ativa = false WHERE id = $1', [ids.setor])).rejects.toThrow(/cargos ativos vinculados/);
    const vg = await versao(ids.ger!);
    expect(await definirSituacaoUnidade(grh(), ids.ger!, vg, false, { cliente: app })).toMatchObject({ ok: false, erros: [{ mensagem: expect.stringContaining('unidade(s) ativa(s) abaixo') }] });
  });

  it('inativa a folha livre; não reativa com a superior inativa; inativada, não recebe cargo', async () => {
    const vs2 = await versao(ids.setor2!);
    expect(await definirSituacaoUnidade(grh(), ids.setor2!, vs2, false, { cliente: app })).toEqual({ ok: true, valor: { versao: vs2 + 1 } });
    const vg2 = await versao(ids.ger2!);
    expect(await definirSituacaoUnidade(grh(), ids.ger2!, vg2, false, { cliente: app })).toMatchObject({ ok: true });
    expect(await definirSituacaoUnidade(grh(), ids.setor2!, vs2 + 1, true, { cliente: app })).toMatchObject({ ok: false, erros: [{ mensagem: expect.stringContaining('superior') }] });
    const outro = (await migrator.query(`SELECT id FROM cargo WHERE ativo ORDER BY codigo OFFSET 1 LIMIT 1`)).rows[0].id;
    await expect(migrator.query('UPDATE cargo SET vinculo_funcional_id = $1 WHERE id = $2', [ids.setor2, outro])).rejects.toThrow(/analítica ativa/);
  });

  it('nome repetido também no renomear e na reativação (índice único entre as ativas)', async () => {
    // Renomear a Coordenadoria para o nome do Setor irmão.
    const vc = await versao(ids.coord!);
    expect(await renomearUnidade(grh(), ids.coord!, vc, 'Setor de Compras', { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    // Inativa uma folha nova, cria outra ativa com o mesmo nome e tenta reativar a primeira.
    await incluir('folha', 'Setor Temporário', 'SETOR', 'ger');
    expect(await definirSituacaoUnidade(grh(), ids.folha!, await versao(ids.folha!), false, { cliente: app })).toMatchObject({ ok: true });
    await incluir('folha2', 'Setor Temporário', 'SETOR', 'ger');
    expect(await definirSituacaoUnidade(grh(), ids.folha!, await versao(ids.folha!), true, { cliente: app })).toMatchObject({
      ok: false,
      erros: [{ mensagem: expect.stringContaining('Já existe uma unidade ativa') }],
    });
  });

  it('sem a permissão, nada muda', async () => {
    await expect(incluirUnidade(leitor(), { nome: 'X', tipo: 'DIRETORIA', superiorId: null }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(renomearUnidade(leitor(), ids.dir!, 1, 'Y', { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(obterTelaEstruturaFuncional(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });
});
