import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { Dinheiro } from '@/shared/kernel';
import { criarPrisma } from '@/shared/db';
import type { ServicoIA } from '@/shared/ia';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { incluirBem } from './bens';
import type { DepsOrc } from './deps';
import { destacarRiscos, montarMensagemPrevisao, SEM_RISCO } from './ia-previsao';
import { montarArquivoRealizado } from './planilhas-teste';
import { obterPrevisaoFechamento } from './previsao-fechamento';
import { criarProposta } from './propostas';
import { carregarRealizado } from './realizado';

// Previsão de fechamento do ano (US-091; IA-10; plano do P34). Como sgo_app (RLS real): o orçado é o cronograma da
// versão oficializada; o realizado, o carregado. A IA é um falso que devolve o que o teste manda.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `93.${classificacao}`,
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
const AGORA = new Date('2026-11-14T12:00:00Z');
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, agora: () => AGORA });

let orcamentista: string;
let gfin: string;
let tp: { id: string; unidadeId: string };
const ctx = (usuarioId: string, unidades: string[], permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'u',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(permissoes),
  unidades,
  unidadeId: null,
});
const gfinCtx = (extra: string[] = []) => ctx(gfin, [tp.unidadeId], ['orc.oxr:consultar', 'orc.realizado:executar', ...extra]);
const exigirOk = <T,>(r: { ok: true; valor: T } | { ok: false; erros: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
};
async function usuario(login: string): Promise<string> {
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const iaFalsa = (resposta: unknown, chamadas: string[] = []) =>
  ({
    gerarEstruturado: async (_c: unknown, _caso: unknown, mensagem: string) => {
      chamadas.push(mensagem);
      return { valor: resposta };
    },
    disponivel: async () => true,
  }) as unknown as ServicoIA;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario('prev.orc');
  gfin = await usuario('prev.gfin');
  tp = exigirOk(
    await criarProposta(
      ctx(orcamentista, [], ['orc.propostas:consultar', 'orc.propostas:incluir']),
      { tipo: 'TERMO_PARCERIA', numero: 'TP-P01/2026', objeto: 'Objeto do TP', parceiro: '', inicio: '2026-01-01', fim: '2027-12-31', categoria: 'CONSOLIDADA', cc: '9.1' },
      comDeps(),
    ),
  );
  // Orçado: 2 × 1.000,00 em fev/2026 e 500,00 em mar/2026 (2.500,00 no ano), na versão 1 oficializada.
  const o = ctx(orcamentista, [tp.unidadeId], ['orc.propostas:consultar', ...['consultar', 'incluir', 'alterar', 'excluir'].map((a) => `orc.bens:${a}`)]);
  for (const [data, quantidade, valorUnitario] of [['2026-02-10', '2', '1.000,00'], ['2026-03-05', '1', '500,00']] as const) {
    const capa = (await migrator.propostaTp.findUniqueOrThrow({ where: { id: tp.id } })).versao;
    exigirOk(await incluirBem(o, { propostaId: tp.id, versaoCapa: capa, conta: '4.1.1.5.005', descricao: 'Item', data, quantidade, valorUnitario }, comDeps()));
  }
  const v = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: tp.id } });
  await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE id = ${v.id}::uuid`;
  await migrator.snapshotVersao.create({ data: { unidadeId: v.unidadeId, versaoPropostaId: v.id, valorGlobal: '2500.00', contas: { '4.1.1.5.005': '2500.00' }, geradoPor: orcamentista } });
  // Realizado: fev 1.500,00 e mar 1.650,00; o acumulado passa dos 2.500,00 do ano em mar.
  exigirOk(
    await carregarRealizado(gfinCtx(), { propostaId: tp.id, arquivo: await montarArquivoRealizado([['4.1.1.5.005', '2026-02', 1500], ['4.1.1.5.005', '2026-03', 1650]]) }, comDeps()),
  );
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('obterPrevisaoFechamento (US-091)', () => {
  it('o ano padrão é o corrente; corte no último mês com realizado; a conta em risco com o mês do estouro; a consulta vai ao Histórico', async () => {
    const antes = await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'CONSULTA' } });
    const r = await obterPrevisaoFechamento(gfinCtx(), { proposta: tp.id }, comDeps());
    const t = r.tela!;
    expect([t.ano, t.anos, t.mesCorte]).toEqual([2026, [2026, 2027], '2026-03']);
    const c = t.contas[0]!;
    expect([c.conta, c.orcadoAno.paraString(), c.realizadoAteCorte.paraString(), c.projetadoAno.paraString(), c.desvio.paraString(), c.tendencia?.formatar(), c.risco, c.mesEstouro]).toEqual([
      '4.1.1.5.005',
      '2500.00',
      '3150.00',
      '3150.00',
      '650.00',
      '126,00%',
      true,
      '2026-03',
    ]);
    expect(t.total.risco).toBe(true);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'CONSULTA' } })).toBe(antes + 1);
  });

  it('ano sem realizado: a projeção é o orçado; ano fora da vigência: erro; sem permissão: negado', async () => {
    const t = (await obterPrevisaoFechamento(gfinCtx(), { proposta: tp.id, ano: '2027' }, comDeps())).tela!;
    expect([t.mesCorte, t.contas.length, t.total.risco]).toEqual([null, 0, false]);
    expect((await obterPrevisaoFechamento(gfinCtx(), { proposta: tp.id, ano: '2030' }, comDeps())).erro).toBe('Escolha um ano dentro da vigência do Termo de Parceria.');
    await expect(obterPrevisaoFechamento(ctx(gfin, [tp.unidadeId], ['orc.realizado:consultar']), {}, comDeps())).rejects.toThrow();
  });
});

describe('destacarRiscos (IA-10)', () => {
  it('a IA recebe só os números do motor e o mês; o destaque usa o mês e o desvio do motor; conta inventada é descartada', async () => {
    const chamadas: string[] = [];
    const ia = iaFalsa(
      {
        texto: 'A conta de material estoura em março.',
        destaques: [
          { conta: '4.1.1.5.005', motivo: 'Gasto acima do previsto.' },
          { conta: '9.9.9.9.999', motivo: 'Conta inventada.' },
        ],
      },
      chamadas,
    );
    const r = exigirOk(await destacarRiscos(gfinCtx(['orc.ia_previsao:executar']), { proposta: tp.id }, { ...comDeps(), ia }));
    expect(r.destaques).toEqual([{ conta: '4.1.1.5.005', descricao: 'Material de escritório', mesEstouro: '2026-03', desvio: '650,00', motivo: 'Gasto acima do previsto.' }]);
    expect(chamadas[0]).toContain('- 4.1.1.5.005 (Material de escritório): orçado do ano R$ 2.500,00;');
    expect(chamadas[0]).toContain('estouro em Mar/26.');
    expect(chamadas[0]).not.toContain('Objeto do TP');
  });

  it('sem a permissão do caso: erro sem chamar a IA; sem conta em risco: a resposta pronta, sem chamar a IA', async () => {
    const chamadas: string[] = [];
    const ia = iaFalsa({ texto: 'x'.repeat(20), destaques: [] }, chamadas);
    const sem = await destacarRiscos(gfinCtx(), { proposta: tp.id }, { ...comDeps(), ia });
    expect(sem.ok).toBe(false);
    const r = exigirOk(await destacarRiscos(gfinCtx(['orc.ia_previsao:executar']), { proposta: tp.id, ano: '2027' }, { ...comDeps(), ia }));
    expect(r).toEqual({ texto: SEM_RISCO, destaques: [] });
    expect(chamadas).toEqual([]);
  });

  it('a mensagem diz quando ainda não há realizado no ano', () => {
    const t = { numero: 'TP-1', ano: 2027, mesCorte: null, semPessoal: true, total: { orcadoAno: Dinheiro.zero(), projetadoAno: Dinheiro.zero() } };
    expect(montarMensagemPrevisao(t as never, [])).toContain('Ainda não há realizado no ano');
  });
});
