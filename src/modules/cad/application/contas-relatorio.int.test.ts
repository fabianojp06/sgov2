import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { sinteticasDoRelatorio } from '../infrastructure/contas-relatorio';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { alterarContasRelatorio, MSG_PAPEL, MSG_SO_SINTETICA, obterTelaContasRelatorio } from './contas-relatorio';

// Contas dos relatórios (US-097), com Postgres real, o plano de contas de referência e o papel sgo_app (só UPDATE
// do valor no parametro_sistema). Os testes compartilham o banco e dependem da ordem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;
let sinteticas: string[];
let analitica: string;

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
const gfin = () => ctx(['cad.plano_contas:consultar', 'cad.plano_contas:executar']);
const leitor = () => ctx(['cad.plano_contas:consultar']);

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
  sinteticas = (await migrator.query(`SELECT classificacao FROM conta_contabil WHERE tipo = 'SINTETICA' AND ativa ORDER BY classificacao DESC LIMIT 2`)).rows.map(
    (r: { classificacao: string }) => r.classificacao,
  );
  analitica = (await migrator.query(`SELECT classificacao FROM conta_contabil WHERE tipo = 'ANALITICA' AND ativa LIMIT 1`)).rows[0].classificacao;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('contas dos relatórios (US-097)', () => {
  it('a seed deixa os dois papéis vazios; a tela lista as sintéticas ativas; sem a permissão, recusa', async () => {
    const tela = await obterTelaContasRelatorio(leitor(), { cliente: app });
    expect(tela.papeis.map((p) => [p.papel, p.marcadas, p.valor])).toEqual([
      ['viagens', [], ''],
      ['imobilizado', [], ''],
    ]);
    const { rows } = await migrator.query(`SELECT count(*)::int AS n FROM conta_contabil WHERE tipo = 'SINTETICA' AND ativa`);
    expect(tela.sinteticas).toHaveLength(rows[0].n);
    await expect(obterTelaContasRelatorio(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(alterarContasRelatorio(leitor(), { papel: 'viagens', classificacoes: sinteticas, anterior: '' }, { cliente: app })).rejects.toBeInstanceOf(
      ErroPermissao,
    );
  });

  it('a GFIN marca pelo sgo_app, em ordem e sem repetição, com o antes e o depois no Histórico; o relatório lê', async () => {
    const r = await alterarContasRelatorio(gfin(), { papel: 'viagens', classificacoes: [...sinteticas, sinteticas[0]!], anterior: '' }, { cliente: app });
    const esperado = [...sinteticas].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    expect(r).toEqual({ ok: true, valor: { valor: esperado.join(',') } });
    expect(await sinteticasDoRelatorio(app, 'viagens')).toEqual(esperado);
    expect(await sinteticasDoRelatorio(app, 'imobilizado')).toEqual([]);
    const { rows } = await migrator.query(
      `SELECT registro_id, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas' AND registro_id = 'relatorio.sinteticas_viagens'`,
    );
    expect(rows).toEqual([{ registro_id: 'relatorio.sinteticas_viagens', antes: { contas: [] }, depois: { contas: esperado } }]);
  });

  it('valor anterior diferente do gravado → concorrência; analítica ou papel desconhecido → recusa, sem gravar', async () => {
    const atual = (await sinteticasDoRelatorio(app, 'viagens')).join(',');
    expect(await alterarContasRelatorio(gfin(), { papel: 'viagens', classificacoes: [], anterior: '' }, { cliente: app })).toMatchObject({
      ok: false,
      erros: [{ mensagem: expect.stringContaining('alterado por outro usuário') }],
    });
    expect(await alterarContasRelatorio(gfin(), { papel: 'viagens', classificacoes: [analitica], anterior: atual }, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'classificacoes', mensagem: MSG_SO_SINTETICA }],
    });
    expect(await alterarContasRelatorio(gfin(), { papel: 'outro', classificacoes: [], anterior: '' }, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MSG_PAPEL }],
    });
    expect((await sinteticasDoRelatorio(app, 'viagens')).join(',')).toBe(atual);
  });

  it('desmarcar tudo grava vazio', async () => {
    const atual = (await sinteticasDoRelatorio(app, 'viagens')).join(',');
    expect(await alterarContasRelatorio(gfin(), { papel: 'viagens', classificacoes: [], anterior: atual }, { cliente: app })).toEqual({ ok: true, valor: { valor: '' } });
    expect(await sinteticasDoRelatorio(app, 'viagens')).toEqual([]);
  });
});
