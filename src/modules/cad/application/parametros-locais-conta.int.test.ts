import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedCad } from '../infrastructure/seed';
import { seedDadosReferenciaCad } from '../infrastructure/seed-referencia';
import { carregarIndiceEstrutura, listarArvoreContas } from '../infrastructure/estrutura-financeira';
import { alterarParametroLocal, obterTelaParametrosLocais } from './parametros-locais-conta';

// Parâmetros locais das contas analíticas (US-045), com Postgres real e o papel sgo_app. Os testes
// compartilham o banco e dependem da ordem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
const gfin = () => ctx(['cad.plano_contas:consultar', 'cad.plano_contas:executar']);
const leitor = () => ctx(['cad.plano_contas:consultar']);
const idDa = async (classificacao: string) => (await migrator.query('SELECT id FROM conta_contabil WHERE classificacao = $1', [classificacao])).rows[0].id as string;
let analitica: { id: string; classificacao: string };

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
  analitica = (await migrator.query(`SELECT id, classificacao FROM conta_contabil WHERE tipo = 'ANALITICA' AND ativa ORDER BY classificacao LIMIT 1`)).rows[0];
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('parâmetros locais das contas (US-045)', () => {
  it('a tela lista só as analíticas ativas, sem parâmetro (versão 0), com as faixas do exercício mais recente', async () => {
    const tela = await obterTelaParametrosLocais(leitor(), { cliente: app });
    const { rows } = await migrator.query(`SELECT count(*)::int AS n FROM conta_contabil WHERE tipo = 'ANALITICA' AND ativa`);
    expect(tela.contas).toHaveLength(rows[0].n);
    expect(tela.contas[0]).toMatchObject({ classificacao: analitica.classificacao, natureza: null, semaforo: null, versao: 0 });
    expect(tela.faixasExercicio).toEqual({ verdeAte: '70', amareloAte: '85', laranjaAte: '95' });
    await expect(obterTelaParametrosLocais(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('quem só consulta não altera', async () => {
    await expect(alterarParametroLocal(leitor(), analitica.id, 0, { natureza: 'OPEX', semaforo: null }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('inclui pelo sgo_app (versão 1), com o Histórico de inclusão', async () => {
    const r = await alterarParametroLocal(gfin(), analitica.id, 0, { natureza: 'OPEX', semaforo: null }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: 1 } });
    const h = (await migrator.query(`SELECT tipo_operacao AS tipo, registro_id, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(h).toEqual({ tipo: 'INSERCAO', registro_id: analitica.classificacao, antes: null, depois: { natureza: 'OPEX', semaforo: null } });
  });

  it('altera com faixas próprias (versão 2); a tela mostra as faixas e o Histórico o antes e o depois', async () => {
    const r = await alterarParametroLocal(gfin(), analitica.id, 1, { natureza: 'CAPEX', semaforo: { verdeAte: '60', amareloAte: '80,5', laranjaAte: '90' } }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: 2 } });
    const conta = (await obterTelaParametrosLocais(leitor(), { cliente: app })).contas.find((c) => c.contaId === analitica.id);
    expect(conta).toMatchObject({ natureza: 'CAPEX', semaforo: { verdeAte: '60', amareloAte: '80,5', laranjaAte: '90' }, versao: 2 });
    const h = (await migrator.query(`SELECT tipo_operacao AS tipo, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(h).toEqual({ tipo: 'ALTERACAO', antes: { natureza: 'OPEX', semaforo: null }, depois: { natureza: 'CAPEX', semaforo: ['60', '80.5', '90'] } });
  });

  it('o C1 expõe a natureza: na árvore de contas e no contaAnaliticaCapex do índice (US-072, #138)', async () => {
    const indice = await carregarIndiceEstrutura(app);
    expect(indice.contaAnaliticaCapex(analitica.classificacao)).toBe(true);
    const outra = (await migrator.query(`SELECT classificacao FROM conta_contabil WHERE tipo = 'ANALITICA' AND ativa AND id <> $1 LIMIT 1`, [analitica.id])).rows[0].classificacao;
    expect(indice.contaAnaliticaCapex(outra)).toBe(false);
    const achar = (nos: readonly { classificacao: string; natureza?: string | null; filhos: readonly unknown[] }[]): { natureza?: string | null } | undefined => {
      for (const n of nos) {
        if (n.classificacao === analitica.classificacao) return n;
        const f = achar(n.filhos as typeof nos);
        if (f) return f;
      }
      return undefined;
    };
    expect(achar(await listarArvoreContas(app))?.natureza).toBe('CAPEX');
  });

  it('salvar sem mudança não sobe a versão nem grava Histórico', async () => {
    const antes = (await migrator.query(`SELECT count(*)::int AS n FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas'`)).rows[0].n;
    const r = await alterarParametroLocal(gfin(), analitica.id, 2, { natureza: 'CAPEX', semaforo: { verdeAte: '60', amareloAte: '80.5', laranjaAte: '90' } }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: 2 } });
    expect((await migrator.query(`SELECT count(*)::int AS n FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas'`)).rows[0].n).toBe(antes);
  });

  it('versão desatualizada, ou inclusão de quem não viu a primeira gravação → concorrência, sem gravar', async () => {
    for (const versao of [1, 0]) {
      const r = await alterarParametroLocal(gfin(), analitica.id, versao, { natureza: 'OPEX', semaforo: null }, { cliente: app });
      expect(r).toMatchObject({ ok: false, erros: [{ campo: '_', mensagem: expect.stringContaining('alterado por outro usuário') }] });
    }
    expect((await migrator.query('SELECT natureza, versao FROM conta_parametro_local WHERE conta_id = $1', [analitica.id])).rows[0]).toEqual({ natureza: 'CAPEX', versao: 2 });
  });

  it('conta sintética ou desconhecida é recusada; faixas inválidas, também', async () => {
    const sintetica = await idDa('4');
    expect(await alterarParametroLocal(gfin(), sintetica, 0, { natureza: 'OPEX', semaforo: null }, { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: '_' }] });
    expect(await alterarParametroLocal(gfin(), '00000000-0000-4000-8000-0000000000ff', 0, { natureza: 'OPEX', semaforo: null }, { cliente: app })).toMatchObject({ ok: false });
    // Id mal formado (36 hífens) não chega ao banco: falha, e não erro do Postgres.
    expect(await alterarParametroLocal(gfin(), '-'.repeat(36), 0, { natureza: 'OPEX', semaforo: null }, { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: '_' }] });
    expect(await alterarParametroLocal(gfin(), analitica.id, 2, { natureza: null, semaforo: { verdeAte: '85', amareloAte: '70', laranjaAte: '95' } }, { cliente: app })).toMatchObject({
      ok: false,
      erros: [{ campo: 'semaforo' }],
    });
  });

  it('o banco também protege: só analítica (trigger), faixas inteiras e em ordem (CHECK), e o app não apaga', async () => {
    const sintetica = await idDa('4');
    await expect(migrator.query(`INSERT INTO conta_parametro_local (conta_id, natureza) VALUES ($1, 'OPEX')`, [sintetica])).rejects.toThrow(/só em conta analítica/);
    const outra = (await migrator.query(`SELECT id FROM conta_contabil WHERE tipo = 'ANALITICA' AND ativa ORDER BY classificacao OFFSET 1 LIMIT 1`)).rows[0].id;
    await expect(migrator.query(`INSERT INTO conta_parametro_local (conta_id, semaforo_verde_ate) VALUES ($1, 70)`, [outra])).rejects.toThrow(/semaforo_check/);
    await expect(migrator.query(`INSERT INTO conta_parametro_local (conta_id, semaforo_verde_ate, semaforo_amarelo_ate, semaforo_laranja_ate) VALUES ($1, 90, 80, 95)`, [outra])).rejects.toThrow(/semaforo_check/);
    await expect(app.$executeRawUnsafe(`DELETE FROM conta_parametro_local WHERE conta_id = '${analitica.id}'`)).rejects.toThrow(/permission denied/);
  });

  it('conta inativada pela recarga: o parâmetro fica gravado, some da tela, e o banco recusa gravar nela', async () => {
    await migrator.query('UPDATE conta_contabil SET ativa = false, inativada_em = clock_timestamp() WHERE id = $1', [analitica.id]);
    try {
      expect((await obterTelaParametrosLocais(leitor(), { cliente: app })).contas.some((c) => c.contaId === analitica.id)).toBe(false);
      expect((await migrator.query('SELECT versao FROM conta_parametro_local WHERE conta_id = $1', [analitica.id])).rows[0].versao).toBe(2);
      await expect(migrator.query(`UPDATE conta_parametro_local SET natureza = 'OPEX' WHERE conta_id = $1`, [analitica.id])).rejects.toThrow(/analítica ativa/);
    } finally {
      await migrator.query('UPDATE conta_contabil SET ativa = true, inativada_em = NULL WHERE id = $1', [analitica.id]);
    }
  });
});
