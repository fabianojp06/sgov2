import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { NoTotal } from '../domain/totalizador';
import { excluirBem, incluirBem } from './bens';
import type { DepsOrc } from './deps';
import { incluirEmpregado } from './empregados';
import { listarMetas } from './metas';
import { criarProposta, listarPropostas, novaVersaoProposta } from './propostas';
import { obterTotalizadores, propostasParaTotalizar } from './totalizadores';
import { incluirTeto, incluirViagem } from './viagens';

// Totalizadores da proposta de TP (US-074; plano do P23, Task 1). Como sgo_app (RLS real). O C1 é o falso do
// cad (CONTAS_EXEMPLO); o C2, o custo falso (salário × meses, tudo na conta de salário, premissas só de 2027).
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
const RAIZ_TPS = cc('9', 'Termos de Parceria', false, [cc('9.1', 'TP de exemplo 1', true), cc('9.2', 'TP de exemplo 2', true)]);
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
const [C001] = cargosExemplo().map((c) => c.id) as [string];
const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargosExemplo()), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio });

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const TODAS = [
  'orc.propostas:consultar',
  'orc.propostas:incluir',
  'orc.metas:consultar',
  'orc.totalizadores:consultar',
  ...LANCA.flatMap((a) => [`orc.empregados:${a}`, `orc.viagens:${a}`, `orc.bens:${a}`]),
];
const CONSULTA = ['orc.propostas:consultar', 'orc.metas:consultar', 'orc.totalizadores:consultar', 'orc.empregados:consultar'];
let seq = 0;
let orcamentista: string;

async function usuario(): Promise<string> {
  const login = `tot${++seq}`;
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
async function proposta() {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2028-06-30', categoria: 'CONSOLIDADA', cc: '9.1' },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
const exigirOk = (r: { ok: boolean; erros?: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
};
/** Pessoal (7.500 × 10 meses de 2027; 2028 sem parâmetros), uma viagem e dois bens (um inativado depois). */
async function lancarTudo(propostaId: string) {
  exigirOk(
    await incluirEmpregado(
      await ctx(),
      { propostaId, versaoCapa: await versaoCapa(propostaId), categoria: 'EMPREGADO', nome: 'Ana', cargoId: C001, inicio: '2027-03', fim: '2028-02', dependentes: '0' },
      comDeps(),
    ),
  );
  exigirOk(await incluirTeto(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), contaSintetica: '4.1.1.5', valor: '100.000,00' }, comDeps()));
  // passagem 2 × 1.000,00 + diária 2 × 3 × 250,00 = 3.500,00 em 4.1.1.5.005; transporte 2 × 50,00 = 100,00 em 4.1.1.2.001.
  exigirOk(
    await incluirViagem(
      await ctx(),
      {
        propostaId,
        versaoCapa: await versaoCapa(propostaId),
        localidade: 'Brasil',
        pessoas: '2',
        dias: '3',
        valorPassagem: '1.000,00',
        valorDiaria: '250,00',
        valorTransporte: '50,00',
        contaPassagem: '4.1.1.5.005',
        contaDiaria: '4.1.1.5.005',
        contaTransporte: '4.1.1.2.001',
      },
      comDeps(),
    ),
  );
  exigirOk(
    await incluirBem(
      await ctx(),
      { propostaId, versaoCapa: await versaoCapa(propostaId), conta: '4.1.1.5.005', descricao: 'Notebook', data: '2027-05-10', quantidade: '2', valorUnitario: '1.000,00' },
      comDeps(),
    ),
  );
}
const achar = (nos: readonly NoTotal[], c: string): NoTotal | undefined => {
  for (const n of nos) {
    if (n.classificacao === c) return n;
    const f = achar(n.filhos, c);
    if (f) return f;
  }
  return undefined;
};

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

describe('obterTotalizadores (UC03.02)', () => {
  it('soma pessoal (só 2027, com aviso), viagem com transporte e bens por conta; as sintéticas somam as filhas', async () => {
    const p = await proposta();
    await lancarTudo(p.id);
    const t = (await obterTotalizadores(await ctx(), p.id, comDeps()))!;
    const valor = (c: string) => achar(t.arvore, c)?.orcado.paraString();
    expect(valor('4.1.1.1.001')).toBe('75000.00');
    expect(valor('4.1.1.5.005')).toBe('5500.00');
    expect(valor('4.1.1.2.001')).toBe('100.00');
    expect(valor('4.1.1')).toBe('80600.00');
    expect(valor('4')).toBe('80600.00');
    expect(t.total.paraString()).toBe('80600.00');
    expect(t.avisos).toContain(M.EMPREGADO_SEM_PARAMETROS(2028));
    expect(achar(t.arvore, '4.1.1.5.005')).toMatchObject({ semaforo: 'VERDE', analitica: true });
    expect(achar(t.arvore, '4.1.1.1.003')).toBeUndefined();
    expect(t.semPessoal).toBe(false);
  });

  it('o bem inativo não soma (Review Focus 2)', async () => {
    const p = await proposta();
    await lancarTudo(p.id);
    exigirOk(await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps()));
    const bem = await migrator.bemProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id, numero: 2 } } });
    exigirOk(await excluirBem(await ctx(), { id: bem.id, versao: 0, versaoCapa: await versaoCapa(p.id) }, comDeps()));
    const t = (await obterTotalizadores(await ctx(), p.id, comDeps()))!;
    expect(t.versaoNumero).toBe(2);
    expect(achar(t.arvore, '4.1.1.5.005')?.orcado.paraString()).toBe('3500.00');
    expect(t.total.paraString()).toBe('78600.00');
  });

  it('quem só consulta não vê o pessoal: sai da soma, com aviso (Review Focus 4); o Valor Global segue a mesma regra', async () => {
    const p = await proposta();
    await lancarTudo(p.id);
    const consulta = await ctx(CONSULTA);
    const t = (await obterTotalizadores(consulta, p.id, comDeps()))!;
    expect(t.semPessoal).toBe(true);
    expect(achar(t.arvore, '4.1.1.1.001')).toBeUndefined();
    expect(t.total.paraString()).toBe('5600.00');
    const lista = await listarPropostas(consulta, comDeps());
    expect(lista.find((x) => x.id === p.id)?.valorGlobal.paraString()).toBe('5600.00');
    expect(lista.find((x) => x.id === p.id)?.valorGlobalSemPessoal).toBe(true);
    const completa = await listarPropostas(await ctx(), comDeps());
    expect(completa.find((x) => x.id === p.id)?.valorGlobal.paraString()).toBe('80600.00');
    expect(completa.find((x) => x.id === p.id)?.valorGlobalSemPessoal).toBe(false);
  });

  it('o Valor Global aparece também nas metas (D-P23-6)', async () => {
    const p = await proposta();
    await lancarTudo(p.id);
    const blocos = await listarMetas(await ctx(), { proposta: p.numero }, comDeps());
    // A Consolidada não tem metas, mas o bloco não aparece só se o filtro de meta estiver ativo.
    expect(blocos.find((b) => b.propostaId === p.id)?.valorGlobal.paraString()).toBe('80600.00');
  });

  it('proposta vazia: árvore vazia e total zero (E1); id inválido ou de outro: nulo; e a lista para escolher', async () => {
    const p = await proposta();
    const t = (await obterTotalizadores(await ctx(), p.id, comDeps()))!;
    expect(t.arvore).toEqual([]);
    expect(t.total.ehZero()).toBe(true);
    expect(await obterTotalizadores(await ctx(), 'x', comDeps())).toBeNull();
    expect(await obterTotalizadores(await ctx(), '00000000-0000-4000-8000-000000000000', comDeps())).toBeNull();
    expect((await propostasParaTotalizar(await ctx(), comDeps())).map((x) => x.id)).toContain(p.id);
    await expect(obterTotalizadores(await ctx(['orc.propostas:consultar']), p.id, comDeps())).rejects.toThrow();
  });
});
