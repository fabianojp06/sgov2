import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds, type TxCliente } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { competenciaDe, type AnoMes } from '../domain/impostos';
import { impostosVigentes } from '../infrastructure/impostos';
import { seedCad } from '../infrastructure/seed';
import { alterarImposto, incluirAliquota, incluirImposto, obterTelaImpostos, removerAliquotaFutura } from './impostos';

// Impostos e alíquotas com vigência (US-052), com Postgres real e o papel sgo_app. Os testes
// compartilham o banco e dependem da ordem. As competências são relativas ao mês corrente.
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
const gfin = () => ctx(['cad.impostos:consultar', 'cad.impostos:incluir', 'cad.impostos:alterar']);
const leitor = () => ctx(['cad.impostos:consultar']);
const somar = (c: AnoMes, meses: number): AnoMes => {
  const d = new Date(Date.UTC(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1 + meses, 1));
  return d.toISOString().slice(0, 7) as AnoMes;
};
const atual = competenciaDe(new Date());
const idDo = async (nome: string) => (await migrator.query('SELECT id FROM imposto WHERE nome = $1', [nome])).rows[0].id as string;
const ultimoHistorico = async () =>
  (
    await migrator.query(
      `SELECT tipo_operacao AS tipo, registro_id, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.impostos' ORDER BY id DESC LIMIT 1`,
    )
  ).rows[0];

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  await executarSeeds(m, [seedAdm, seedCad]);
  await executarSeeds(m, [seedAdm, seedCad]); // idempotente
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  usuarioId = (
    await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GFIN', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`)
  ).rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('impostos e alíquotas (US-052)', () => {
  it('a seed traz PIS e COFINS (contrato) e ISS (ambos), sem alíquota; o catálogo dá a GFIN incluir e alterar', async () => {
    const tela = await obterTelaImpostos(leitor(), { cliente: app });
    expect(tela.mesAtual).toBe(atual);
    expect(tela.impostos.map((i) => [i.nome, i.incidencia, i.vigente, i.aliquotas.length])).toEqual([
      ['COFINS', 'CONTRATO', null, 0],
      ['ISS', 'AMBOS', null, 0],
      ['PIS', 'CONTRATO', null, 0],
    ]);
    const { rows } = await migrator.query(
      `SELECT p.codigo || ' ' || pf.acao AS l FROM perfil_permissao pf JOIN perfil p ON p.id = pf.perfil_id
       WHERE pf.funcionalidade_codigo = 'cad.impostos' ORDER BY 1`,
    );
    expect(rows.map((r) => r.l)).toEqual(['AUDITOR consultar', 'GFIN alterar', 'GFIN consultar', 'GFIN incluir', 'ORCAMENTISTA consultar']);
    await expect(obterTelaImpostos(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('inclui imposto pelo sgo_app, com Histórico; nome repetido (sem diferenciar caixa) é rejeitado', async () => {
    await expect(incluirImposto(leitor(), { nome: 'IRRF', incidencia: 'AMBOS' }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    const r = await incluirImposto(gfin(), { nome: ' IRRF ', incidencia: 'TERMO_PARCERIA' }, { cliente: app });
    expect(r.ok).toBe(true);
    expect(await ultimoHistorico()).toMatchObject({ tipo: 'INSERCAO', depois: { nome: 'IRRF', incidencia: 'TERMO_PARCERIA' } });
    expect(await incluirImposto(gfin(), { nome: 'irrf', incidencia: 'AMBOS' }, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: 'nome', mensagem: 'Operação rejeitada: já existe um imposto cadastrado com o nome irrf.' }],
    });
  });

  it('altera o imposto com a versão; versão velha é concorrência; renomear para nome existente é rejeitado', async () => {
    const id = await idDo('IRRF');
    expect(await alterarImposto(gfin(), id, 1, { nome: 'IRRF', incidencia: 'AMBOS', ativo: false }, { cliente: app })).toEqual({ ok: true, valor: { versao: 2 } });
    expect(await ultimoHistorico()).toMatchObject({ tipo: 'ALTERACAO', antes: { incidencia: 'TERMO_PARCERIA', ativo: true }, depois: { incidencia: 'AMBOS', ativo: false } });
    const velha = await alterarImposto(gfin(), id, 1, { nome: 'IRRF', incidencia: 'CONTRATO', ativo: false }, { cliente: app });
    expect(velha.ok).toBe(false);
    // A mesma versão velha, com os dados que já estão no banco: também é concorrência.
    expect((await alterarImposto(gfin(), id, 1, { nome: 'IRRF', incidencia: 'AMBOS', ativo: false }, { cliente: app })).ok).toBe(false);
    const repetido = await alterarImposto(gfin(), id, 2, { nome: 'pis', incidencia: 'AMBOS', ativo: false }, { cliente: app });
    expect(repetido).toEqual({ ok: false, erros: [{ campo: 'nome', mensagem: 'Operação rejeitada: já existe um imposto cadastrado com o nome pis.' }] });
  });

  it('inclui alíquota atual e futura; a tela mostra a vigente e o histórico; competência repetida e retroativa são rejeitadas', async () => {
    const pis = await idDo('PIS');
    expect(await incluirAliquota(gfin(), pis, { competencia: atual, percentual: '0,65' }, { cliente: app })).toEqual({ ok: true, valor: { competencia: atual } });
    expect(await ultimoHistorico()).toMatchObject({ tipo: 'INSERCAO', registro_id: pis, depois: { competencia: atual, percentual: '0.6500' } });
    const futura = somar(atual, 2);
    expect((await incluirAliquota(gfin(), pis, { competencia: futura, percentual: '1' }, { cliente: app })).ok).toBe(true);
    const tela = await obterTelaImpostos(leitor(), { cliente: app });
    expect(tela.impostos.find((i) => i.nome === 'PIS')).toMatchObject({
      vigente: { competencia: atual, percentual: '0,65', futura: false },
      aliquotas: [
        { competencia: futura, percentual: '1', futura: true },
        { competencia: atual, percentual: '0,65', futura: false },
      ],
    });
    const repetida = await incluirAliquota(gfin(), pis, { competencia: futura, percentual: '2' }, { cliente: app });
    expect(repetida).toEqual({ ok: false, erros: [{ campo: 'competencia', mensagem: 'Já existe alíquota para essa competência. Remova a futura antes de incluir outra.' }] });
    const retro = await incluirAliquota(gfin(), pis, { competencia: somar(atual, -1), percentual: '2' }, { cliente: app });
    expect(retro.ok).toBe(false);
  });

  it('o banco recusa alíquota retroativa, alteração de alíquota e remoção da que já vale, mesmo direto', async () => {
    const pis = await idDo('PIS');
    await expect(
      migrator.query(`INSERT INTO aliquota_imposto (imposto_id, competencia, percentual) VALUES ($1, $2::date, 1)`, [pis, `${somar(atual, -1)}-01`]),
    ).rejects.toThrow(/Alíquota retroativa/);
    await expect(migrator.query(`UPDATE aliquota_imposto SET percentual = 9 WHERE imposto_id = $1`, [pis])).rejects.toThrow(/não se altera/);
    await expect(migrator.query(`DELETE FROM aliquota_imposto WHERE imposto_id = $1 AND competencia = $2::date`, [pis, `${atual}-01`])).rejects.toThrow(
      /em vigor ou passada/,
    );
    await expect(
      migrator.query(`INSERT INTO aliquota_imposto (imposto_id, competencia, percentual) VALUES ($1, $2::date, 1)`, [pis, `${somar(atual, 3)}-15`]),
    ).rejects.toThrow();
    await expect(migrator.query(`INSERT INTO aliquota_imposto (imposto_id, competencia, percentual) VALUES ($1, $2::date, 100.5)`, [pis, `${somar(atual, 3)}-01`])).rejects.toThrow();
  });

  it('remove só a alíquota futura, com Histórico de exclusão; a vigente não sai', async () => {
    const pis = await idDo('PIS');
    const futura = somar(atual, 2);
    expect(await removerAliquotaFutura(leitor(), pis, futura, { cliente: app }).catch((e) => e)).toBeInstanceOf(ErroPermissao);
    expect(await removerAliquotaFutura(gfin(), pis, futura, { cliente: app })).toEqual({ ok: true, valor: { removida: true } });
    expect(await ultimoHistorico()).toMatchObject({ tipo: 'EXCLUSAO', registro_id: pis, antes: { competencia: futura, percentual: '1.0000' } });
    expect(await removerAliquotaFutura(gfin(), pis, futura, { cliente: app })).toEqual({ ok: true, valor: { removida: false } });
    const vigente = await removerAliquotaFutura(gfin(), pis, atual, { cliente: app });
    expect(vigente.ok).toBe(false);
  });

  it('impostosVigentes (contrato do C2): só os ativos, filtrados pelo tipo, com a alíquota da competência', async () => {
    const iss = await idDo('ISS');
    await incluirAliquota(gfin(), iss, { competencia: somar(atual, 1), percentual: '5' }, { cliente: app });
    const ler = (competencia: string, opcoes?: { tipo?: 'CONTRATO' | 'TERMO_PARCERIA' }) =>
      app.$transaction((tx: TxCliente) => impostosVigentes(tx, competencia, opcoes));
    const agora = await ler(atual);
    expect(agora.map((i) => [i.nome, i.percentual?.paraString() ?? null, i.desde])).toEqual([
      ['COFINS', null, null],
      ['ISS', null, null],
      ['PIS', '0.6500', atual],
    ]);
    const tp = await ler(somar(atual, 1), { tipo: 'TERMO_PARCERIA' });
    expect(tp.map((i) => [i.nome, i.percentual?.paraString() ?? null, i.desde])).toEqual([['ISS', '5.0000', somar(atual, 1)]]);
    expect(await ler('2026-13')).toEqual([]);
  });
});

describe('impostos: a recusa do banco chega como mensagem (relógio do app atrasado em relação ao banco)', () => {
  it('alíquota que o app julga atual, mas o banco já vê como retroativa, e remoção da que já passou a valer', async () => {
    const pis = await idDo('PIS');
    const mesPassado = somar(atual, -1);
    const noMesPassado = () => new Date(Date.UTC(Number(mesPassado.slice(0, 4)), Number(mesPassado.slice(5, 7)) - 1, 15, 12));
    expect(await incluirAliquota(gfin(), pis, { competencia: mesPassado, percentual: '1' }, { cliente: app, agora: noMesPassado })).toEqual({
      ok: false,
      erros: [{ campo: 'competencia', mensagem: 'A vigência de uma alíquota não pode ser retroativa.' }],
    });
    expect(await removerAliquotaFutura(gfin(), pis, atual, { cliente: app, agora: noMesPassado })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'A alíquota passou a valer. Recarregue a tela.' }],
    });
  });

  it('a seed não recria imposto renomeado e grava Histórico só na primeira vez', async () => {
    const { rows } = await migrator.query(`SELECT count(*)::int AS n FROM historico_operacao WHERE funcionalidade = 'cad.impostos' AND tipo_operacao = 'SISTEMA'`);
    expect(rows[0].n).toBe(3);
    const pis = await idDo('PIS');
    expect((await alterarImposto(gfin(), pis, 1, { nome: 'PIS-PASEP', incidencia: 'CONTRATO', ativo: true }, { cliente: app })).ok).toBe(true);
    const m = criarPrisma(banco.urlMigrator);
    await executarSeeds(m, [seedAdm, seedCad]);
    await m.$disconnect();
    expect((await migrator.query(`SELECT count(*)::int AS n FROM imposto WHERE lower(nome) = 'pis'`)).rows[0].n).toBe(0);
  });
});
