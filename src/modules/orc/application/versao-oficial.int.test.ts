import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { incluirBem } from './bens';
import type { DepsOrc } from './deps';
import { incluirEmpregado } from './empregados';
import { incluirMeta } from './metas';
import { criarProposta } from './propostas';
import { bensDaVersaoOficial, empregadosDaVersaoOficial } from './versao-oficial';

// Portas da versão oficializada para os demonstrativos da frente B (pedido na #138; US-097 e US-098). Como sgo_app (RLS real).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `91.${classificacao}`,
  descricao: `CC ${classificacao}`,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: analitico ? 'ANALITICO' : 'SINTETICO',
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: true,
  filhos,
});
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, cc('9', false, [cc('9.1', true), cc('9.2', true)])] });
const [C001] = cargosExemplo().map((c) => c.id) as [string];
const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargosExemplo()), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio });

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const ORCAMENTISTA = ['orc.propostas:consultar', 'orc.propostas:incluir', 'orc.realizado:consultar', ...LANCA.flatMap((a) => [`orc.metas:${a}`, `orc.bens:${a}`, `orc.empregados:${a}`])];
let orcamentista: string;
let gfin: string;
const tps: Record<'a' | 'b', { id: string; unidadeId: string }> = {} as never;

async function usuario(login: string): Promise<string> {
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const ctx = (usuarioId: string, unidades: string[], permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'u',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(permissoes),
  unidades,
  unidadeId: null,
});
const orcA = () => ctx(orcamentista, [tps.a.unidadeId], ORCAMENTISTA);
const gfinA = () => ctx(gfin, [tps.a.unidadeId], ['orc.realizado:consultar']);
const versaoCapa = async () => (await migrator.propostaTp.findUniqueOrThrow({ where: { id: tps.a.id } })).versao;
const exigirOk = <T,>(r: { ok: true; valor: T } | { ok: false; erros: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
};

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario('vo.orc');
  gfin = await usuario('vo.gfin');
  for (const [k, numero, c] of [['a', 'TP-V01/2027', '9.1'], ['b', 'TP-V02/2027', '9.2']] as const) {
    const r = await criarProposta(
      ctx(orcamentista, [], ['orc.propostas:consultar', 'orc.propostas:incluir']),
      { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-12-31', categoria: 'META', cc: c },
      comDeps(),
    );
    tps[k] = exigirOk(r);
  }
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('portas da versão oficializada (pedido da frente B na #138)', () => {
  it('sem versão oficializada: versão nula e listas vazias; TP inexistente ou de outra unidade: nulo; sem a permissão: negado', async () => {
    expect(await bensDaVersaoOficial(gfinA(), { tp: 'TP-V01/2027' }, comDeps())).toEqual({ versao: null, itens: [] });
    expect(await empregadosDaVersaoOficial(gfinA(), { tp: 'TP-V01/2027' }, comDeps())).toEqual({ versao: null, categoriaTp: 'META', lote: null, empregados: [] });
    expect(await bensDaVersaoOficial(gfinA(), { tp: 'TP-X99/2027' }, comDeps())).toBeNull();
    const deB = ctx(gfin, [tps.b.unidadeId], ['orc.realizado:consultar']);
    expect(await bensDaVersaoOficial(deB, { tp: 'TP-V01/2027' }, comDeps())).toBeNull();
    expect(await empregadosDaVersaoOficial(deB, { tp: 'TP-V01/2027' }, comDeps())).toBeNull();
    const semPermissao = ctx(gfin, [tps.a.unidadeId], ['orc.bens:consultar', 'orc.empregados:consultar']);
    await expect(bensDaVersaoOficial(semPermissao, { tp: 'TP-V01/2027' }, comDeps())).rejects.toThrow();
    await expect(empregadosDaVersaoOficial(semPermissao, { tp: 'TP-V01/2027' }, comDeps())).rejects.toThrow();
  });

  it('lê a versão oficializada, não a mais nova; só os bens ativos, por data; o custo só para quem vê o pessoal', async () => {
    const meta = { propostaId: tps.a.id, numero: '1', nome: 'Meta 1', valor: '0', status: 'ATIVO' };
    exigirOk(await incluirMeta(orcA(), { ...meta, versaoCapa: await versaoCapa() }, comDeps()));
    const metaId = (await migrator.metaProposta.findFirstOrThrow({ where: { numero: '1', versaoProposta: { propostaId: tps.a.id } } })).id;
    const bem = (descricao: string, data: string) => ({ propostaId: tps.a.id, metaId, conta: '4.1.1.5.005', descricao, data, quantidade: '2', valorUnitario: '1.000,00' });
    exigirOk(await incluirBem(orcA(), { ...bem('Projetor', '2027-06-01'), versaoCapa: await versaoCapa() }, comDeps()));
    exigirOk(await incluirBem(orcA(), { ...bem('Notebook', '2027-02-10'), versaoCapa: await versaoCapa() }, comDeps()));
    exigirOk(await incluirBem(orcA(), { ...bem('Inativo', '2027-03-01'), versaoCapa: await versaoCapa() }, comDeps()));
    await migrator.bemProposta.updateMany({ where: { descricao: 'Inativo' }, data: { ativo: false, inativadoEm: new Date() } });
    exigirOk(
      await incluirEmpregado(
        orcA(),
        { propostaId: tps.a.id, versaoCapa: await versaoCapa(), metaId, categoria: 'EMPREGADO', nome: 'Ana', cargoId: C001, inicio: '2027-03', fim: '2027-12', dependentes: '0' },
        comDeps(),
      ),
    );
    // A versão 1 oficializada (como a US-079 deixa) e uma versão 2 em rascunho, com um bem que não pode aparecer.
    const v1 = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: tps.a.id, numero: 1 } });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE id = ${v1.id}::uuid`;
    await migrator.snapshotVersao.create({ data: { unidadeId: v1.unidadeId, versaoPropostaId: v1.id, valorGlobal: '4000.00', contas: { '4.1.1.5.005': '4000.00' }, geradoPor: orcamentista } });
    const v2 = await migrator.versaoProposta.create({ data: { unidadeId: v1.unidadeId, propostaId: tps.a.id, numero: 2, criadoPor: orcamentista } });
    await migrator.bemProposta.create({
      data: { unidadeId: v1.unidadeId, versaoPropostaId: v2.id, conta: '4.1.1.5.005', descricao: 'Da versão 2', data: new Date('2027-01-05'), quantidade: 1, valorUnitario: '9.00', criadoPor: orcamentista },
    });

    const bens = await bensDaVersaoOficial(gfinA(), { tp: 'TP-V01/2027' }, comDeps());
    expect(bens?.versao).toBe(1);
    expect(bens?.itens.map((b) => [b.descricao, b.data, b.conta, b.quantidade, b.valorUnitario.paraString(), b.metaNumero])).toEqual([
      ['Notebook', '2027-02-10', '4.1.1.5.005', 2, '1000.00', '1'],
      ['Projetor', '2027-06-01', '4.1.1.5.005', 2, '1000.00', '1'],
    ]);

    const semCusto = await empregadosDaVersaoOficial(gfinA(), { tp: 'TP-V01/2027' }, comDeps());
    expect([semCusto?.versao, semCusto?.categoriaTp, semCusto?.lote]).toEqual([1, 'META', 'EM_ELABORACAO']);
    expect(semCusto?.empregados).toEqual([
      expect.objectContaining({ ordem: 1, nome: 'Ana', categoria: 'EMPREGADO', inicio: '2027-03', fim: '2027-12', metaNumero: '1', metaNome: 'Meta 1', custoMensal: null }),
    ]);
    expect(semCusto?.empregados[0]?.cargo).toMatch(/ – /);

    const comCusto = await empregadosDaVersaoOficial(orcA(), { tp: 'TP-V01/2027' }, comDeps());
    const mensal = comCusto?.empregados[0]?.custoMensal;
    expect(mensal && !mensal.ehZero() && !mensal.ehNegativo()).toBe(true);
  });
});
