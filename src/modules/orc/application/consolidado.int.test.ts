import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { emTodasAsUnidades, emUnidade } from '@/shared/unidade';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { incluirBem } from './bens';
import { obterComparativoTps, obterConsolidado } from './consolidado';
import type { DepsOrc } from './deps';
import { incluirEmpregado } from './empregados';
import { criarProposta } from './propostas';

// Consolidado dos TPs (US-101; plano do P31, Task 1). Como sgo_app (RLS real): o Orçamentista cria três TPs; a
// DIREX, sem vínculo com nenhum, vê todos pelo caminho emTodasAsUnidades.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, descricao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `90.${classificacao}`,
  descricao,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: analitico ? 'ANALITICO' : 'SINTETICO',
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: true,
  filhos,
});
const RAIZ = cc('9', 'Termos de Parceria', false, ['9.1', '9.2', '9.3', '9.4'].map((c) => cc(c, `TP ${c}`, true)));
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ] });
const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargosExemplo()), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio });

let orcamentista: string;
let direx: string;
const ids: Record<string, { id: string; unidadeId: string }> = {};

async function usuario(login: string): Promise<string> {
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId: string, permissoes: string[]): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}
const CONSOLIDADO = ['orc.consolidado:consultar'];
const consultas = () => migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.consolidado', tipoOperacao: 'CONSULTA' } });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario('cons.orc');
  direx = await usuario('cons.direx');
  for (const [numero, c] of [['TP-C01/2027', '9.1'], ['TP-C02/2027', '9.2'], ['TP-C03/2027', '9.3'], ['TP-C04/2027', '9.4']] as const) {
    const r = await criarProposta(
      await ctx(orcamentista, ['orc.propostas:consultar', 'orc.propostas:incluir']),
      { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-12-31', categoria: 'CONSOLIDADA', cc: c },
      comDeps(),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    ids[numero] = { id: r.valor.id, unidadeId: r.valor.unidadeId };
  }
  // TP-C01 com um bem de 2 × 1.000,00 e um empregado de jan a mar (para o comparativo da US-106).
  const o = async () => ctx(orcamentista, ['orc.propostas:consultar', 'orc.propostas:incluir', ...['consultar', 'incluir', 'alterar', 'excluir'].flatMap((a) => [`orc.bens:${a}`, `orc.empregados:${a}`])]);
  const capa = async () => (await migrator.propostaTp.findUniqueOrThrow({ where: { id: ids['TP-C01/2027']!.id } })).versao;
  const exigirOk = (r: { ok: boolean; erros?: unknown }) => {
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
  };
  exigirOk(
    await incluirBem(await o(), { propostaId: ids['TP-C01/2027']!.id, versaoCapa: await capa(), conta: '4.1.1.5.005', descricao: 'Notebook', data: '2027-02-10', quantidade: '2', valorUnitario: '1.000,00' }, comDeps()),
  );
  exigirOk(
    await incluirEmpregado(
      await o(),
      { propostaId: ids['TP-C01/2027']!.id, versaoCapa: await capa(), categoria: 'EMPREGADO', nome: 'Ana', cargoId: cargosExemplo()[0]!.id, inicio: '2027-01', fim: '2027-03', dependentes: '0' },
      comDeps(),
    ),
  );
  // TP-C02 oficializado (snapshot de 1.234,56); TP-C03 excluído; a unidade do TP-C04 inativa.
  const v2 = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: ids['TP-C02/2027']!.id } });
  await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE id = ${v2.id}::uuid`;
  await migrator.snapshotVersao.create({ data: { unidadeId: v2.unidadeId, versaoPropostaId: v2.id, valorGlobal: '1234.56', contas: { '4.1.1.5.005': '1234.56' }, geradoPor: orcamentista } });
  await migrator.propostaTp.update({ where: { id: ids['TP-C03/2027']!.id }, data: { excluidaEm: new Date(), excluidaPor: orcamentista } });
  await migrator.unidade.update({ where: { id: ids['TP-C04/2027']!.unidadeId }, data: { ativo: false } });
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('obterConsolidado (US-101)', () => {
  it('quem não tem vínculo com nenhum TP vê todos os ativos (Review Focus 1); excluído e inativo ficam de fora (5); a consulta vai ao Histórico (4)', async () => {
    const antes = await consultas();
    const c = await obterConsolidado(await ctx(direx, CONSOLIDADO), comDeps());
    expect(c.linhas.map((l) => [l.numero, l.situacao, l.versaoOficial, l.orcado?.paraString() ?? null, l.percentual?.paraString() ?? null])).toEqual([
      ['TP-C01/2027', 'RASCUNHO', null, null, null],
      ['TP-C02/2027', 'OFICIALIZADO', 1, '1234.56', '0.00'],
    ]);
    expect(c.totalOrcado.paraString()).toBe('1234.56');
    expect(c.oficializados).toBe(1);
    expect(await consultas()).toBe(antes + 1);
    // A mesma pessoa, pelo caminho comum, não vê nenhum TP (a RLS continua valendo fora do consolidado).
    expect(await emUnidade(await ctx(direx, CONSOLIDADO), (tx) => tx.propostaTp.count(), { cliente: app })).toBe(0);
  });

  it('sem a permissão: erro, sem dado e sem registro (Review Focus 2)', async () => {
    const antes = await consultas();
    await expect(obterConsolidado(await ctx(direx, ['orc.propostas:consultar']), comDeps())).rejects.toThrow();
    expect(await consultas()).toBe(antes);
  });

  it('a transação do caminho é só de leitura: uma escrita é recusada pelo banco (Review Focus 3)', async () => {
    await expect(
      emTodasAsUnidades(await ctx(direx, CONSOLIDADO), (tx) => tx.propostaTp.updateMany({ data: { objeto: 'alterado' } }), { cliente: app }),
    ).rejects.toThrow(/read-only/);
    expect(await migrator.propostaTp.count({ where: { objeto: 'alterado' } })).toBe(0);
  });

  it('o comparativo entre TPs (US-106 da frente B): a versão oficial ou a última, as somas por origem e os postos; registrado e com a mesma permissão', async () => {
    const antes = await consultas();
    const c = await obterComparativoTps(await ctx(direx, CONSOLIDADO), comDeps());
    expect(c.map((x) => [x.numero, x.oficial, x.versao, x.situacao])).toEqual([
      ['TP-C01/2027', false, 1, 'RASCUNHO'],
      ['TP-C02/2027', true, 1, 'OFICIALIZADO'],
    ]);
    const [c01, c02] = c as [(typeof c)[number], (typeof c)[number]];
    expect(c01.porCategoria.bens.paraString()).toBe('2000.00');
    expect(c01.porCategoria.pessoal.ehZero()).toBe(false);
    expect(c01.postos).toBe(1);
    expect(c01.valorGlobal.paraString()).toBe(c01.porCategoria.pessoal.somar(c01.porCategoria.bens).paraString());
    expect(c01.porCategoria.outros.ehZero()).toBe(true);
    // O oficial vale pelo snapshot; sem lançamentos na versão, a diferença fica em outros.
    expect([c02.valorGlobal.paraString(), c02.porCategoria.outros.paraString(), c02.postos]).toEqual(['1234.56', '1234.56', 0]);
    expect(c02.vigencia).toEqual({ inicio: '2027-01', fim: '2027-12' });
    expect(await consultas()).toBe(antes + 1);
    await expect(obterComparativoTps(await ctx(direx, ['orc.propostas:consultar']), comDeps())).rejects.toThrow();
  });
});
