import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds, type TxCliente } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MSG_MINIMO } from '../domain/agrupadores';
import { agrupadoresDeContas } from '../infrastructure/agrupadores';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { alterarAgrupador, excluirAgrupador, incluirAgrupador, obterTelaAgrupadores } from './agrupadores';

// Agrupadores de contas (US-047), com Postgres real e o papel sgo_app. Os testes compartilham o banco e
// dependem da ordem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
let analiticas: { id: string; classificacao: string }[];
let sintetica: string;

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
const gfin = () => ctx(['cad.plano_contas:consultar', 'cad.plano_contas:executar']);
const leitor = () => ctx(['cad.plano_contas:consultar']);
const ultimoHistorico = async () =>
  (
    await migrator.query(
      `SELECT tipo_operacao AS tipo, registro_id, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas' ORDER BY id DESC LIMIT 1`,
    )
  ).rows[0];
let idPassagens: string;

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
    await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`)
  ).rows[0].id;
  analiticas = (await migrator.query(`SELECT id, classificacao FROM conta_contabil WHERE tipo = 'ANALITICA' AND ativa ORDER BY classificacao LIMIT 3`)).rows;
  sintetica = (await migrator.query(`SELECT id FROM conta_contabil WHERE tipo = 'SINTETICA' LIMIT 1`)).rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('agrupadores de contas (US-047)', () => {
  it('a tela começa vazia, com as analíticas ativas para escolher; quem só consulta não inclui', async () => {
    const tela = await obterTelaAgrupadores(leitor(), { cliente: app });
    expect(tela.agrupadores).toEqual([]);
    expect(tela.contas.slice(0, 3).map((c) => c.id)).toEqual(analiticas.map((a) => a.id));
    await expect(obterTelaAgrupadores(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(incluirAgrupador(leitor(), { nome: 'X', contaIds: [analiticas[0]!.id, analiticas[1]!.id] }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('inclui com duas contas, pelo sgo_app, com Histórico; nome repetido (sem diferenciar caixa) e uma conta só são rejeitados', async () => {
    const r = await incluirAgrupador(gfin(), { nome: 'Passagens aéreas', contaIds: [analiticas[0]!.id, analiticas[1]!.id] }, { cliente: app });
    expect(r.ok).toBe(true);
    if (r.ok) idPassagens = r.valor.id;
    expect(await ultimoHistorico()).toMatchObject({
      tipo: 'INSERCAO',
      registro_id: idPassagens,
      depois: { agrupador: 'Passagens aéreas', contas: [analiticas[0]!.classificacao, analiticas[1]!.classificacao] },
    });
    const repetido = await incluirAgrupador(gfin(), { nome: 'PASSAGENS AÉREAS', contaIds: [analiticas[0]!.id, analiticas[2]!.id] }, { cliente: app });
    expect(repetido.ok).toBe(false);
    if (!repetido.ok) expect(repetido.erros[0]!.mensagem).toMatch(/Já existe um Agrupador com este nome/);
    expect(await incluirAgrupador(gfin(), { nome: 'Uma', contaIds: [analiticas[0]!.id] }, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'contas', mensagem: MSG_MINIMO }],
    });
  });

  it('a mesma conta pode estar em vários agrupadores (RN_PLA_011); conta sintética é recusada', async () => {
    expect((await incluirAgrupador(gfin(), { nome: 'Outro', contaIds: [analiticas[0]!.id, analiticas[2]!.id] }, { cliente: app })).ok).toBe(true);
    const r = await incluirAgrupador(gfin(), { nome: 'Com sintética', contaIds: [analiticas[0]!.id, sintetica] }, { cliente: app });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'contas', mensagem: 'Uma das contas escolhidas não é analítica ativa. Recarregue a tela.' }] });
    expect((await migrator.query(`SELECT 1 FROM agrupador_conta WHERE nome = 'Com sintética'`)).rows).toEqual([]);
  });

  it('altera nome e contas com a versão, com Histórico do antes e do depois; versão velha é concorrência', async () => {
    const r = await alterarAgrupador(gfin(), idPassagens, 1, { nome: 'Passagens', contaIds: [analiticas[1]!.id, analiticas[2]!.id] }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: 2 } });
    expect(await ultimoHistorico()).toMatchObject({
      tipo: 'ALTERACAO',
      antes: { agrupador: 'Passagens aéreas', contas: [analiticas[0]!.classificacao, analiticas[1]!.classificacao] },
      depois: { agrupador: 'Passagens', contas: [analiticas[1]!.classificacao, analiticas[2]!.classificacao] },
    });
    const velha = await alterarAgrupador(gfin(), idPassagens, 1, { nome: 'Passagens', contaIds: [analiticas[1]!.id, analiticas[2]!.id] }, { cliente: app });
    expect(velha.ok).toBe(false);
    const semMudar = await alterarAgrupador(gfin(), idPassagens, 2, { nome: 'Passagens', contaIds: [analiticas[2]!.id, analiticas[1]!.id] }, { cliente: app });
    expect(semMudar).toEqual({ ok: true, valor: { versao: 2 } });
  });

  it('o banco recusa, mesmo direto, agrupador com menos de duas contas e conta sintética', async () => {
    await migrator.query('BEGIN');
    await migrator.query(`DELETE FROM agrupador_conta_item WHERE agrupador_id = $1 AND conta_id = $2`, [idPassagens, analiticas[1]!.id]);
    await expect(migrator.query('COMMIT')).rejects.toThrow(/menos de duas contas/);
    await migrator.query('BEGIN');
    await migrator.query(`INSERT INTO agrupador_conta (nome) VALUES ('Vazio')`);
    await expect(migrator.query('COMMIT')).rejects.toThrow(/menos de duas contas/);
    await expect(migrator.query(`INSERT INTO agrupador_conta_item (agrupador_id, conta_id) VALUES ($1, $2)`, [idPassagens, sintetica])).rejects.toThrow(
      /conta analítica ativa/,
    );
    expect((await migrator.query(`SELECT count(*)::int AS n FROM agrupador_conta_item WHERE agrupador_id = $1`, [idPassagens])).rows[0].n).toBe(2);
  });

  it('conta inativada por recarga continua no agrupador; editar só o nome a mantém; tirá-la é escolha do usuário', async () => {
    await migrator.query(`UPDATE conta_contabil SET ativa = false, inativada_em = now() WHERE id = $1`, [analiticas[2]!.id]);
    const tela = await obterTelaAgrupadores(leitor(), { cliente: app });
    expect(tela.agrupadores.find((a) => a.id === idPassagens)!.contas.map((c) => [c.id, c.ativa])).toEqual([
      [analiticas[1]!.id, true],
      [analiticas[2]!.id, false],
    ]);
    expect(tela.contas.some((c) => c.id === analiticas[2]!.id)).toBe(false);
    // A tela manda as contas que tinha (inclusive a inativa): só o nome muda.
    const r = await alterarAgrupador(gfin(), idPassagens, 2, { nome: 'Passagens (rev.)', contaIds: [analiticas[1]!.id, analiticas[2]!.id] }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: 3 } });
    expect((await migrator.query(`SELECT count(*)::int AS n FROM agrupador_conta_item WHERE agrupador_id = $1`, [idPassagens])).rows[0].n).toBe(2);
    // Tirar a inativa deixaria uma conta só: recusado, dentro da transação, com a mensagem da minuta.
    expect(await alterarAgrupador(gfin(), idPassagens, 3, { nome: 'Passagens (rev.)', contaIds: [analiticas[1]!.id] }, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'contas', mensagem: MSG_MINIMO }],
    });
    // Reativada pela recarga, a conta segue no agrupador como qualquer outra.
    await migrator.query(`UPDATE conta_contabil SET ativa = true, inativada_em = NULL WHERE id = $1`, [analiticas[2]!.id]);
    expect((await alterarAgrupador(gfin(), idPassagens, 3, { nome: 'Passagens', contaIds: [analiticas[1]!.id, analiticas[2]!.id] }, { cliente: app })).ok).toBe(true);
  });

  it('agrupador inexistente: edição e exclusão respondem sem gravar', async () => {
    const nada = '00000000-0000-4000-8000-000000000000';
    expect((await alterarAgrupador(gfin(), nada, 1, { nome: 'X', contaIds: [analiticas[0]!.id, analiticas[1]!.id] }, { cliente: app })).ok).toBe(false);
    expect((await excluirAgrupador(gfin(), nada, 1, { cliente: app })).ok).toBe(false);
  });

  it('agrupadoresDeContas (para os relatórios): cada agrupador com as contas, em ordem', async () => {
    const lidos = await app.$transaction((tx: TxCliente) => agrupadoresDeContas(tx));
    expect(lidos.map((a) => [a.nome, a.contas.map((c) => c.classificacao)])).toEqual([
      ['Outro', [analiticas[0]!.classificacao, analiticas[2]!.classificacao]],
      ['Passagens', [analiticas[1]!.classificacao, analiticas[2]!.classificacao]],
    ]);
  });

  it('exclui com a versão, levando as vinculações, com Histórico; versão velha é concorrência', async () => {
    expect((await excluirAgrupador(gfin(), idPassagens, 1, { cliente: app })).ok).toBe(false);
    expect(await excluirAgrupador(gfin(), idPassagens, 4, { cliente: app })).toEqual({ ok: true, valor: { excluido: true } });
    expect(await ultimoHistorico()).toMatchObject({ tipo: 'EXCLUSAO', registro_id: idPassagens, antes: { agrupador: 'Passagens' } });
    expect((await migrator.query(`SELECT count(*)::int AS n FROM agrupador_conta_item WHERE agrupador_id = $1`, [idPassagens])).rows[0].n).toBe(0);
  });

  it('referência de documento (FK RESTRICT) barra a exclusão com a mensagem da RN_PLA_010', async () => {
    const { id: outro, versao } = (await migrator.query(`SELECT id, versao FROM agrupador_conta WHERE nome = 'Outro'`)).rows[0];
    await migrator.query(`CREATE TABLE documento_teste (agrupador_id UUID REFERENCES agrupador_conta(id) ON DELETE RESTRICT)`);
    await migrator.query(`INSERT INTO documento_teste VALUES ($1)`, [outro]);
    const r = await excluirAgrupador(gfin(), outro, versao, { cliente: app });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]!.mensagem).toMatch(/^Exclusão Bloqueada/);
    await migrator.query(`DROP TABLE documento_teste`);
  });
});
