import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto, type NoConta } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { campoCelula, campoConta } from '../domain/rateio';
import { incluirBem } from './bens';
import type { DepsOrc } from './deps';
import { incluirEmpregado } from './empregados';
import { criarProposta, duplicarProposta, listarPropostas, novaVersaoProposta } from './propostas';
import { excluirRateio, obterRateio, replicarRateio, salvarRateio } from './rateio';
import { obterTotalizadores } from './totalizadores';

// Rateio e ISS da proposta de TP (US-073; plano do P24, Task 1). Como sgo_app (RLS real). O C1 é um trecho com o
// pessoal (4.1.1.1), material (4.1.1.5) e a taxa da Adm. Central (4.3.1.1.001), fora da base.
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
const conta = (classificacao: string, descricao: string, filhos: NoConta[] = []): NoConta => {
  const nivel = classificacao.split('.').length as NoConta['nivel'];
  return {
    classificacao,
    codigoReduzido: nivel === 5 ? `6${classificacao.replace(/\./g, '')}` : null,
    descricao,
    nivel,
    tipo: nivel === 5 ? 'ANALITICA' : 'SINTETICA',
    ativa: true,
    filhos,
  };
};
const CONTAS: NoConta[] = [
  conta('4', 'DESPESAS', [
    conta('4.1', 'OPERACIONAIS', [
      conta('4.1.1', 'SERVIÇOS', [conta('4.1.1.1', 'PESSOAL', [conta('4.1.1.1.001', 'Salários')]), conta('4.1.1.5', 'ADMINISTRATIVAS', [conta('4.1.1.5.005', 'Material')])]),
    ]),
    conta('4.3', 'INDIRETAS', [
      conta('4.3.1', 'ADM. CENTRAL', [conta('4.3.1.1', 'TAXAS', [conta('4.3.1.1.001', 'Taxa de Administração Central'), conta('4.3.1.1.002', 'Outra taxa')])]),
    ]),
  ]),
];
const RAIZ_TPS = cc('9', 'Termos de Parceria', false, [cc('9.1', 'TP de exemplo 1', true), cc('9.2', 'TP de exemplo 2', true)]);
const estrutura = estruturaFinanceiraFalsa({ contas: CONTAS, centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
const [C001] = cargosExemplo().map((c) => c.id) as [string];
const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargosExemplo()), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio });

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const TODAS = [
  'orc.propostas:consultar',
  'orc.propostas:incluir',
  'orc.totalizadores:consultar',
  ...LANCA.flatMap((a) => [`orc.empregados:${a}`, `orc.bens:${a}`, `orc.rateio:${a}`]),
];
let seq = 0;
let orcamentista: string;

async function usuario(): Promise<string> {
  const login = `rat${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(permissoes: string[] = TODAS): Promise<ContextoRequisicao> {
  return {
    usuarioId: orcamentista,
    usuarioRotulo: 'orcamentista',
    sessaoUid: 's1',
    ip: null,
    permissoes: new Set(permissoes),
    unidades: await unidadesDe(orcamentista),
    unidadeId: null,
  };
}
const versaoCapa = async (id: string) => (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
const exigirOk = (r: { ok: boolean; erros?: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
};
async function proposta(extra: Record<string, unknown> = {}) {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-03-31', categoria: 'CONSOLIDADA', cc: '9.1', ...extra },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
/** Base 4.1.1 = pessoal (7.500 × 3 meses = 22.500,00) + material (2 × 1.000,00) = 24.500,00. */
async function lancarDespesas(propostaId: string) {
  exigirOk(
    await incluirEmpregado(
      await ctx(),
      { propostaId, versaoCapa: await versaoCapa(propostaId), categoria: 'EMPREGADO', nome: 'Ana', cargoId: C001, inicio: '2027-01', fim: '2027-03', dependentes: '0' },
      comDeps(),
    ),
  );
  exigirOk(
    await incluirBem(
      await ctx(),
      { propostaId, versaoCapa: await versaoCapa(propostaId), conta: '4.1.1.5.005', descricao: 'Notebook', data: '2027-02-10', quantidade: '2', valorUnitario: '1.000,00' },
      comDeps(),
    ),
  );
}
const salvar = async (propostaId: string, campos: Record<string, string>, permissoes = TODAS) =>
  salvarRateio(
    await ctx(permissoes),
    { propostaId, versaoCapa: String(await versaoCapa(propostaId)), contaSintetica: '4.1.1', modo: 'VALOR', [campoConta(0)]: '4.3.1.1.001', ...campos },
    comDeps(),
  );
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });
const erroCampo = (campo: string, mensagem: string) => ({ ok: false, erros: [{ campo, mensagem }] });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
});

describe('salvarRateio e obterRateio (UC03.03)', () => {
  it('salva, reabre com a base e entra nos Totalizadores e no Valor Global (RN_RAT_05, Review Focus 5)', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    const antes = await versaoCapa(p.id);
    expect(await salvar(p.id, { [campoCelula(0, '2027-01')]: '1.000,00', [campoCelula(0, '2027-02')]: '500,00' })).toEqual({ ok: true, valor: { numero: p.numero } });
    expect(await versaoCapa(p.id)).toBe(antes + 1);
    const r = (await obterRateio(await ctx(), p.id, comDeps()))!;
    expect(r.competencias).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(r.base?.paraString()).toBe('24500.00');
    expect(r.grade).toMatchObject({ contaSintetica: '4.1.1', descricaoSintetica: 'SERVIÇOS', modo: 'VALOR', aliquotaIss: null });
    expect(r.grade!.linhas.map((l) => [l.conta, l.descricao, l.total.paraString()])).toEqual([['4.3.1.1.001', 'Taxa de Administração Central', '1500.00']]);
    const t = (await obterTotalizadores(await ctx(), p.id, comDeps()))!;
    expect(t.total.paraString()).toBe('26000.00');
    expect((await listarPropostas(await ctx(), comDeps())).find((x) => x.id === p.id)?.valorGlobal.paraString()).toBe('26000.00');
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.rateio' } });
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', depois: { contaSintetica: '4.1.1', modo: 'VALOR', total: '1500.00', celulas: 2 } });
  });

  it('E3 (sintética sem saldo), E1 (soma acima da base) e destino sob a mandante (Review Focus 1)', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    expect(await salvar(p.id, { contaSintetica: '4.3' })).toEqual(erroCampo('contaSintetica', M.RATEIO_SEM_SALDO));
    expect(await salvar(p.id, { [campoCelula(0, '2027-01')]: '24.500,01' })).toEqual(erroGeral(M.RATEIO_ESTOURO('R$ 24.500,01', 'R$ 24.500,00')));
    expect(await salvar(p.id, { [campoConta(0)]: '4.1.1.5.005', [campoCelula(0, '2027-01')]: '1,00' })).toEqual(erroGeral(M.RATEIO_CONTA_SOB_MANDANTE('4.1.1.5.005', '4.1.1')));
    expect(await salvar(p.id, { [campoConta(0)]: '4.3.1.1', [campoCelula(0, '2027-01')]: '1,00' })).toEqual(erroGeral(`${M.RATEIO_CONTA_ANALITICA} (4.3.1.1)`));
    expect(await migrator.rateioProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(0);
  });

  it('troca de modo: o texto em R$ vira % da base (REQ_RAT_002)', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    exigirOk(await salvar(p.id, { modo: 'PERCENTUAL', modoAnterior: 'VALOR', [campoCelula(0, '2027-01')]: '2.450,00' }));
    const c = await migrator.rateioCelulaProposta.findFirstOrThrow({ where: { rateio: { versaoProposta: { propostaId: p.id } } } });
    expect([c.valor.toString(), c.percentual?.toString()]).toEqual(['2450', '10']);
    // O valor que viraria 0% é recusado, não some (revisão 12.12).
    expect(await salvar(p.id, { modo: 'PERCENTUAL', modoAnterior: 'VALOR', [campoCelula(0, '2027-01')]: '0,01' })).toEqual(erroCampo(campoCelula(0, '2027-01'), M.RATEIO_CONVERSAO_ZERA));
    const semPessoal = ['orc.propostas:consultar', ...LANCA.map((a) => `orc.rateio:${a}`)];
    const r = (await obterRateio(await ctx(semPessoal), p.id, comDeps()))!;
    expect(r.grade!.linhas[0]!.celulas['2027-01']!.percentual).toBeNull();
  });

  it('E2: o Contrato exige a alíquota de 2% a 5%; o TP não guarda', async () => {
    const p = await proposta({ tipo: 'CONTRATO' });
    await lancarDespesas(p.id);
    expect(await salvar(p.id, { aliquotaIss: '6' })).toEqual(erroCampo('aliquotaIss', M.RATEIO_ISS_FORA_DO_LIMITE));
    exigirOk(await salvar(p.id, { aliquotaIss: '3,5', [campoCelula(0, '2027-01')]: '10,00' }));
    expect((await obterRateio(await ctx(), p.id, comDeps()))!.grade!.aliquotaIss?.paraString()).toBe('3.5000');
  });

  it('quem não vê o pessoal não vê a base, mas a trava vale com ela (Review Focus 3)', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    const semPessoal = ['orc.propostas:consultar', 'orc.empregados:consultar', ...LANCA.map((a) => `orc.rateio:${a}`)];
    exigirOk(await salvar(p.id, { [campoCelula(0, '2027-01')]: '20.000,00' }, semPessoal));
    const r = (await obterRateio(await ctx(semPessoal), p.id, comDeps()))!;
    expect(r.base).toBeNull();
    expect(r.baseRestrita).toBe(true);
    // Nem a mensagem do E1 nem o % mostram a base (revisão 12.12).
    expect(await salvar(p.id, { [campoCelula(0, '2027-01')]: '24.500,01' }, semPessoal)).toEqual(erroGeral(M.RATEIO_ESTOURO_RESTRITO('R$ 24.500,01')));
    expect(await salvar(p.id, { modo: 'PERCENTUAL', modoAnterior: 'VALOR', [campoCelula(0, '2027-01')]: '1,00' }, semPessoal)).toEqual(erroCampo('modo', M.RATEIO_PERCENTUAL_RESTRITO));
  });
});

describe('replicar, excluir e cópia (RN_RAT_03, RN_DUP_003)', () => {
  it('replicar leva o primeiro mês aos meses zerados seguintes; o estouro é recusado', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    exigirOk(await salvar(p.id, { [campoCelula(0, '2027-02')]: '1.000,00', [campoConta(1)]: '4.3.1.1.002', [campoCelula(1, '2027-01')]: '20.000,00' }));
    const ok1 = await replicarRateio(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), conta: '4.3.1.1.001' }, comDeps());
    expect(ok1).toEqual({ ok: true, valor: { conta: '4.3.1.1.001' } });
    const linha = (await obterRateio(await ctx(), p.id, comDeps()))!.grade!.linhas.find((l) => l.conta === '4.3.1.1.001')!;
    expect(Object.keys(linha.celulas).sort()).toEqual(['2027-02', '2027-03']);
    expect(await replicarRateio(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), conta: '4.3.1.1.002' }, comDeps())).toEqual(
      erroGeral(M.RATEIO_ESTOURO('R$ 62.000,00', 'R$ 24.500,00')),
    );
  });

  it('a nova versão copia a grade; a duplicação com vigência menor só leva o que cabe, e a troca de tipo tira a alíquota (Review Focus 4)', async () => {
    const p = await proposta({ tipo: 'CONTRATO' });
    await lancarDespesas(p.id);
    exigirOk(await salvar(p.id, { aliquotaIss: '2', [campoCelula(0, '2027-01')]: '100,00', [campoCelula(0, '2027-03')]: '300,00' }));
    exigirOk(await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps()));
    const v2 = await migrator.rateioProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id, numero: 2 } }, include: { celulas: true } });
    expect([v2.aliquotaIss?.toString(), v2.celulas.length]).toEqual(['2', 2]);
    const d = await duplicarProposta(
      await ctx(),
      { origemId: p.id, versaoOrigem: await versaoCapa(p.id), numero: `TP-D${++seq}`, cc: '9.2', tipo: 'TERMO_PARCERIA', fim: '2027-02-28' },
      comDeps(),
    );
    if (!d.ok) throw new Error(JSON.stringify(d.erros));
    const dup = await migrator.rateioProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: d.valor.id } }, include: { celulas: true } });
    expect(dup.aliquotaIss).toBeNull();
    expect(dup.celulas.map((c) => c.valor.toString())).toEqual(['100']);
  });

  it('excluir a grade; na versão imutável, nada muda', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    exigirOk(await salvar(p.id, { [campoCelula(0, '2027-01')]: '100,00' }));
    expect(await excluirRateio(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id) }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero } });
    expect(await migrator.rateioCelulaProposta.count({ where: { rateio: { versaoProposta: { propostaId: p.id } } } })).toBe(0);
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_APROVACAO' } });
    expect(await salvar(p.id, { [campoCelula(0, '2027-01')]: '100,00' })).toEqual(erroGeral(M.RATEIO_VERSAO_IMUTAVEL));
  });
});
