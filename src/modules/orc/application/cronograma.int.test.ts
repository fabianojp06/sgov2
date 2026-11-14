import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto, type NoConta } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { campoCelula, campoConta } from '../domain/rateio';
import { incluirBem } from './bens';
import type { DepsOrc } from './deps';
import { incluirEmpregado } from './empregados';
import { criarProposta } from './propostas';
import { obterCronograma } from './cronograma';
import { salvarRateio } from './rateio';
import { obterTotalizadores } from './totalizadores';
import { incluirTeto, incluirViagem } from './viagens';

// Cronograma de desembolso da proposta de TP (US-075; plano do P25, Task 1). Como sgo_app (RLS real). O C1 é um
// trecho com o pessoal (4.1.1.1), material (4.1.1.5) e a taxa da Adm. Central (4.3.1.1.001); vigência de 7 meses.
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
  'orc.cronograma:consultar',
  ...LANCA.flatMap((a) => [`orc.empregados:${a}`, `orc.bens:${a}`, `orc.rateio:${a}`, `orc.viagens:${a}`]),
];
let seq = 0;
let orcamentista: string;

async function usuario(): Promise<string> {
  const login = `cro${++seq}`;
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
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-07-31', categoria: 'CONSOLIDADA', cc: '9.1', ...extra },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
/** Pessoal 7.500 × 3 meses (jan a mar), material 2 × 1.000,00 em fev, viagem 1.000,00 por igual nos 7 meses. */
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
  exigirOk(await incluirTeto(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), contaSintetica: '4.1.1.5', valor: '10.000,00' }, comDeps()));
  exigirOk(
    await incluirViagem(
      await ctx(),
      {
        propostaId,
        versaoCapa: await versaoCapa(propostaId),
        localidade: 'Brasil',
        pessoas: '1',
        dias: '1',
        valorPassagem: '1.000,00',
        valorDiaria: '0',
        contaPassagem: '4.1.1.5.005',
        contaDiaria: '4.1.1.5.005',
      },
      comDeps(),
    ),
  );
}
/** RN_WA05_005: o pessoal só entra no cronograma com o lote homologado (D-P27-4). */
async function homologarPessoal(propostaId: string) {
  await migrator.$executeRaw`INSERT INTO orc_lote_pessoal (unidade_id, versao_proposta_id, situacao)
    SELECT p.unidade_id, v.id, 'HOMOLOGADO' FROM orc_proposta p JOIN orc_versao_proposta v ON v.proposta_id = p.id WHERE p.id = ${propostaId}::uuid`;
}
/** UC6.02 passo 4: as viagens só entram no cronograma validadas (D-P28-1). */
async function validarViagens(propostaId: string) {
  const [l] = await migrator.$queryRaw<{ id: string }[]>`INSERT INTO orc_lote_viagem (unidade_id, versao_proposta_id, situacao, solicitado_por)
    SELECT p.unidade_id, v.id, 'VALIDADO', ${orcamentista}::uuid FROM orc_proposta p JOIN orc_versao_proposta v ON v.proposta_id = p.id WHERE p.id = ${propostaId}::uuid RETURNING id`;
  await migrator.$executeRaw`UPDATE orc_viagem SET lote_viagem_id = ${l!.id}::uuid WHERE versao_proposta_id IN (SELECT id FROM orc_versao_proposta WHERE proposta_id = ${propostaId}::uuid)`;
}
const salvar = async (propostaId: string, campos: Record<string, string>) =>
  salvarRateio(
    await ctx(),
    { propostaId, versaoCapa: String(await versaoCapa(propostaId)), contaSintetica: '4.1.1', modo: 'VALOR', [campoConta(0)]: '4.3.1.1.001', ...campos },
    comDeps(),
  );

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

describe('obterCronograma (UC04.01)', () => {
  it('a soma dos meses é o Valor Global, com pessoal, bem, viagem distribuída e rateio (Review Focus 1)', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    exigirOk(await salvar(p.id, { [campoCelula(0, '2027-03')]: '700,00' }));
    // Antes da homologação do pessoal e da validação das viagens (Review Focus 2 do P27 e 1 do P28): sem eles, com os avisos.
    const antes = (await obterCronograma(await ctx(), p.id, {}, comDeps()))!;
    expect(antes.pessoalNaoHomologado).toBe(true);
    expect(antes.viagensNaoValidadas).toBe(true);
    expect(antes.total.paraString()).toBe('2700.00');
    expect(antes.porConta.map((x) => x.conta)).toEqual(['4.1.1.5.005', '4.3.1.1.001']);
    await homologarPessoal(p.id);
    await validarViagens(p.id);
    const c = (await obterCronograma(await ctx(), p.id, {}, comDeps()))!;
    expect(c.pessoalNaoHomologado).toBe(false);
    expect(c.viagensNaoValidadas).toBe(false);
    const meses = c.linhas.filter((l) => l.tipo === 'MES');
    expect(meses.map((l) => l.descricao)).toEqual(['01', '02', '03', '04', '05', '06', '07'].map((m, i) => `Parcela ${i + 1} – ${m}/2027`));
    // jan: 7.500 + 142,85; fev: 7.500 + 2.000 + 142,85; mar: 7.500 + 700 + 142,85; abr a jun: 142,85; jul: 142,90.
    expect(meses.map((l) => l.desembolso.paraString())).toEqual(['7642.85', '9642.85', '8342.85', '142.85', '142.85', '142.85', '142.90']);
    const t = (await obterTotalizadores(await ctx(), p.id, comDeps()))!;
    expect(c.total.paraString()).toBe(t.total.paraString());
    expect(c.valorGlobal.paraString()).toBe('26200.00');
    expect(meses.at(-1)!.acumulado.paraString()).toBe('26200.00');
    expect(meses.at(-1)!.percentualAcumulado?.paraString()).toBe('100.0000');
    expect(meses.at(-1)!.repasseCiclo?.paraString()).toBe('26200.00');
    expect(c.linhas.at(-1)).toMatchObject({ tipo: 'ANO', descricao: 'Total de 2027' });
    expect(c.viagensDistribuidas).toBe(true);
    expect(c.meta).toBe('Todos');
    expect(c.porConta.map((x) => [x.conta, x.anos['2027']?.paraString(), x.total.paraString()])).toEqual([
      ['4.1.1.1.001', '22500.00', '22500.00'],
      ['4.1.1.5.005', '3000.00', '3000.00'],
      ['4.3.1.1.001', '700.00', '700.00'],
    ]);
  });

  it('quem não vê o pessoal: sem ele e com aviso (Review Focus 4); id inválido: nulo; sem permissão: erro', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    await homologarPessoal(p.id);
    await validarViagens(p.id);
    const consulta = await ctx(['orc.cronograma:consultar', 'orc.empregados:consultar']);
    const c = (await obterCronograma(consulta, p.id, {}, comDeps()))!;
    expect(c.semPessoal).toBe(true);
    expect(c.total.paraString()).toBe('3000.00');
    expect(c.porConta.map((x) => x.conta)).toEqual(['4.1.1.5.005']);
    expect(await obterCronograma(await ctx(), 'x', {}, comDeps())).toBeNull();
    await expect(obterCronograma(await ctx(['orc.propostas:consultar']), p.id, {}, comDeps())).rejects.toThrow();
  });
});
