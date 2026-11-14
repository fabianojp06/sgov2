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
import { obterPreVisualizacao } from './pre-visualizacao';
import { salvarRateio } from './rateio';
import { obterTotalizadores } from './totalizadores';
import { incluirTeto, incluirViagem } from './viagens';

// Pré-visualização da proposta de TP (US-068; plano do P29, Task 1), com o preparo do teste do cronograma (US-075). Como sgo_app (RLS real). O C1 é um
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
  const login = `prev${++seq}`;
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

describe('obterPreVisualizacao (UC03.38)', () => {
  it('as seções e os totais: a soma das analíticas na sintética e o total igual ao dos totalizadores, com as origens (Review Focus 3)', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    exigirOk(await salvar(p.id, { [campoCelula(0, '2027-03')]: '700,00' }));
    const d = (await obterPreVisualizacao(await ctx(), p.id, comDeps()))!;
    const t = (await obterTotalizadores(await ctx(), p.id, comDeps()))!;
    expect(d).toMatchObject({ numero: p.numero, versaoNumero: 1, situacao: 'RASCUNHO', categoria: 'CONSOLIDADA', vigencia: { inicio: '2027-01', fim: '2027-07' }, semPessoal: false });
    expect(d.valorGlobal.paraString()).toBe(t.total.paraString());
    expect(d.valorGlobal.paraString()).toBe('26200.00');
    expect(d.origens).toEqual({ '4.1.1.1.001': ['PESSOAL'], '4.1.1.5.005': ['VIAGENS', 'BENS'], '4.3.1.1.001': ['RATEIO'] });
    const soma = (n: { orcado: { paraString(): string }; filhos: readonly unknown[] }) => n.orcado.paraString();
    const raiz = d.arvore[0]!;
    expect(soma(raiz)).toBe('26200.00');
    const material = raiz.filhos[0]!.filhos[0]!.filhos.find((f) => f.classificacao === '4.1.1.5')!;
    expect(material.orcado.paraString()).toBe('3000.00');
    expect(material.filhos.map((f) => [f.classificacao, f.orcado.paraString()])).toEqual([['4.1.1.5.005', '3000.00']]);
    // O quantitativo não foi lançado: a seção vem vazia (Review Focus 5).
    expect(d.quantitativos).toEqual([]);
    expect(d.totaisQuantitativos).toEqual({ EMPREGADO: 0, ESTAGIARIO: 0, JOVEM_APRENDIZ: 0 });
  });

  it('quem não vê o pessoal: nem o valor nem a origem dele (Review Focus 1); sem lançamentos, tudo vazio (Review Focus 5); id inválido: nulo', async () => {
    const p = await proposta();
    await lancarDespesas(p.id);
    const d = (await obterPreVisualizacao(await ctx(['orc.propostas:consultar']), p.id, comDeps()))!;
    expect(d.semPessoal).toBe(true);
    expect(d.valorGlobal.paraString()).toBe('3000.00');
    expect(Object.values(d.origens).flat()).not.toContain('PESSOAL');
    expect(d.origens['4.1.1.1.001']).toBeUndefined();

    await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
    const vazia = await proposta();
    const v = (await obterPreVisualizacao(await ctx(), vazia.id, comDeps()))!;
    expect(v).toMatchObject({ arvore: [], foraDoPlano: [], metas: [], quantitativos: [], origens: {} });
    expect(v.valorGlobal.paraString()).toBe('0.00');
    expect(await obterPreVisualizacao(await ctx(), 'x', comDeps())).toBeNull();
    await expect(obterPreVisualizacao(await ctx(['orc.totalizadores:consultar']), p.id, comDeps())).rejects.toThrow();
  });
});
