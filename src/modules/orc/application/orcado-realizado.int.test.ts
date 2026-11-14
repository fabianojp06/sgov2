import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { incluirBem } from './bens';
import type { DepsOrc } from './deps';
import { exportarOrcadoRealizado } from './exportar-oxr';
import { obterOrcadoRealizado } from './orcado-realizado';
import { montarArquivoRealizado } from './planilhas-teste';
import { criarProposta } from './propostas';
import { carregarRealizado } from './realizado';

// Orçado x Realizado (US-086, parte 1; OxR V2, seção 5). Como sgo_app (RLS real): o orçado é o cronograma da versão
// oficializada; o realizado, o carregado pela US-085.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `92.${classificacao}`,
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
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura });

let orcamentista: string;
let gfin: string;
const tps: Record<'oficial' | 'rascunho', { id: string; unidadeId: string }> = {} as never;
const ctx = (usuarioId: string, unidades: string[], permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'u',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(permissoes),
  unidades,
  unidadeId: null,
});
const OXR = ['orc.oxr:consultar'];
const EXPORTAR = [...OXR, 'orc.oxr:exportar'];
const gfinCtx = () => ctx(gfin, [tps.oficial.unidadeId, tps.rascunho.unidadeId], [...OXR, 'orc.realizado:consultar', 'orc.realizado:executar']);
const exigirOk = <T,>(r: { ok: true; valor: T } | { ok: false; erros: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
};
async function usuario(login: string): Promise<string> {
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario('oxr.orc');
  gfin = await usuario('oxr.gfin');
  for (const [k, numero, c] of [['oficial', 'TP-X01/2026', '9.1'], ['rascunho', 'TP-X02/2026', '9.2']] as const) {
    tps[k] = exigirOk(
      await criarProposta(
        ctx(orcamentista, [], ['orc.propostas:consultar', 'orc.propostas:incluir']),
        { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2026-01-01', fim: '2028-06-30', categoria: 'CONSOLIDADA', cc: c },
        comDeps(),
      ),
    );
  }
  // TP-X01: bens de 2 × 1.000,00 em fev/2026 e de 1 × 500,00 em mar/2026, na versão 1 oficializada.
  const o = ctx(orcamentista, [tps.oficial.unidadeId], ['orc.propostas:consultar', ...['consultar', 'incluir', 'alterar', 'excluir'].map((a) => `orc.bens:${a}`)]);
  for (const [data, quantidade, valorUnitario] of [['2026-02-10', '2', '1.000,00'], ['2026-03-05', '1', '500,00']] as const) {
    const capa = (await migrator.propostaTp.findUniqueOrThrow({ where: { id: tps.oficial.id } })).versao;
    exigirOk(await incluirBem(o, { propostaId: tps.oficial.id, versaoCapa: capa, conta: '4.1.1.5.005', descricao: 'Item', data, quantidade, valorUnitario }, comDeps()));
  }
  const v = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: tps.oficial.id } });
  await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE id = ${v.id}::uuid`;
  await migrator.snapshotVersao.create({ data: { unidadeId: v.unidadeId, versaoPropostaId: v.id, valorGlobal: '2500.00', contas: { '4.1.1.5.005': '2500.00' }, geradoPor: orcamentista } });
  // Realizado: fev 1.500,00 (75%), mar 650,00 (130%, estouro) e 80,00 em conta sem orçado (Sem orçamento); uma pendência.
  exigirOk(
    await carregarRealizado(
      gfinCtx(),
      {
        propostaId: tps.oficial.id,
        arquivo: await montarArquivoRealizado([['4.1.1.5.005', '2026-02', 1500], ['4.1.1.5.005', '2026-03', 650], ['4.1.1.1.001', '2026-03', 80], ['9.9.9.9.999', '2026-03', 7]]),
      },
      comDeps(),
    ),
  );
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('obterOrcadoRealizado (US-086)', () => {
  it('sem TP: só a lista dos oficializados; TP vazio: E1', async () => {
    const r = await obterOrcadoRealizado(gfinCtx(), {}, comDeps());
    expect([r.propostas.map((p) => p.numero), r.tela, r.erro]).toEqual([['TP-X01/2026'], null, null]);
    expect((await obterOrcadoRealizado(gfinCtx(), { proposta: '' }, comDeps())).erro).toBe('Selecione um Termo de Parceria para consultar.');
    expect((await obterOrcadoRealizado(gfinCtx(), { proposta: tps.rascunho.id }, comDeps())).erro).toBe('O Orçado x Realizado só existe para Termo de Parceria oficializado.');
  });

  it('a grade: orçado do cronograma oficial, realizado carregado, % do mês, estouro, Sem orçamento, total e saldo do período; a consulta vai ao Histórico', async () => {
    const antes = await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'CONSULTA' } });
    const r = await obterOrcadoRealizado(gfinCtx(), { proposta: tps.oficial.id, de: '2026-01', ate: '2026-03' }, comDeps());
    const t = r.tela!;
    expect([t.meses, t.versaoOficial, t.pendencias.quantidade]).toEqual([['2026-01', '2026-02', '2026-03'], 1, 1]);
    const conta = t.grade.linhas.find((l) => l.conta === '4.1.1.5.005')!;
    expect(conta.meses.map((c) => [c.orcado.paraString(), c.realizado.paraString(), c.uso?.formatar() ?? null, c.estouro])).toEqual([
      ['0.00', '0.00', null, false],
      ['2000.00', '1500.00', '75,00%', false],
      ['500.00', '650.00', '130,00%', true],
    ]);
    expect([conta.periodo.orcado.paraString(), conta.periodo.realizado.paraString(), conta.periodo.saldo.paraString(), conta.periodo.uso?.formatar()]).toEqual([
      '2500.00',
      '2150.00',
      '350.00',
      '86,00%',
    ]);
    // D-P33-2: o GFIN não lança empregados; as contas de pessoal saem dos dois lados, e o total não fica distorcido.
    expect([t.semPessoal, t.grade.linhas.some((l) => l.conta.startsWith('4.1.1.1'))]).toEqual([true, false]);
    expect(t.grade.linhas.find((l) => l.conta === '4')!.periodo.realizado.paraString()).toBe('2150.00');
    expect(t.grade.total.periodo.saldo.paraString()).toBe('350.00');
    // Quem lança os empregados vê a conta de pessoal: realizado sem orçado é "Sem orçamento" (RN_OXR_012).
    const comPessoal = ctx(gfin, [tps.oficial.unidadeId], [...OXR, 'orc.empregados:incluir']);
    const t2 = (await obterOrcadoRealizado(comPessoal, { proposta: tps.oficial.id, de: '2026-01', ate: '2026-03' }, comDeps())).tela!;
    expect([t2.semPessoal, t2.grade.linhas.find((l) => l.conta === '4.1.1.1.001')!.meses[2]!.semOrcamento]).toEqual([false, true]);
    // A raiz 4 soma tudo (RN_OXR_009); as contas zeradas não aparecem (RN_OXR_013, padrão Não).
    expect(t2.grade.linhas.find((l) => l.conta === '4')!.periodo.realizado.paraString()).toBe('2230.00');
    expect(t2.grade.linhas.some((l) => l.conta === '4.1.1.1.003')).toBe(false);
    expect(t2.grade.total.periodo.saldo.paraString()).toBe('270.00');
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'CONSULTA' } })).toBe(antes + 2);
  });

  it('filtro de conta, contas zeradas e período padrão (os primeiros 24 meses da vigência)', async () => {
    const r = await obterOrcadoRealizado(gfinCtx(), { proposta: tps.oficial.id, conta: '4.1.1.5', zeradas: true }, comDeps());
    expect(r.tela!.meses).toHaveLength(24);
    expect(r.tela!.grade.linhas.map((l) => l.conta)).toEqual(['4.1.1.5', '4.1.1.5.005']);
    expect(r.tela!.grade.total.periodo.realizado.paraString()).toBe('2150.00');
  });

  it('período inválido, fora da vigência ou maior que 24 meses: o erro, sem a grade', async () => {
    const erro = async (de: string, ate: string) => (await obterOrcadoRealizado(gfinCtx(), { proposta: tps.oficial.id, de, ate }, comDeps())).erro;
    expect(await erro('2026-05', '2026-03')).toBe('Período inválido: o inicial não pode passar do final.');
    expect(await erro('2025-12', '2026-03')).toBe('O período precisa estar dentro da vigência do Termo de Parceria.');
    expect(await erro('2026-01', '2028-01')).toBe('Escolha um período de até 24 meses.');
    // Só o inicial, depois do 24.º mês: o final padrão conta a partir dele (revisão 12.12).
    const r = await obterOrcadoRealizado(gfinCtx(), { proposta: tps.oficial.id, de: '2028-03' }, comDeps());
    expect([r.erro, r.tela?.meses]).toEqual([null, ['2028-03', '2028-04', '2028-05', '2028-06']]);
  });

  it('RLS: quem não opera o TP não o vê; sem a permissão, negado', async () => {
    const outro = ctx(gfin, [tps.rascunho.unidadeId], OXR);
    const r = await obterOrcadoRealizado(outro, { proposta: tps.oficial.id }, comDeps());
    expect([r.propostas, r.tela, r.erro]).toEqual([[], null, 'Selecione um Termo de Parceria para consultar.']);
    await expect(obterOrcadoRealizado(ctx(gfin, [tps.oficial.unidadeId], ['orc.realizado:consultar']), {}, comDeps())).rejects.toThrow();
  });

  it('exportar (parte 2): XLSX com os mesmos valores e a EXPORTACAO no Histórico, sem CONSULTA; PDF até 6 meses; sem a ação, negado', async () => {
    const c = ctx(gfin, [tps.oficial.unidadeId], EXPORTAR);
    const [consultas, exportacoes] = await Promise.all([
      migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'CONSULTA' } }),
      migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'EXPORTACAO' } }),
    ]);
    const x = exigirOk(await exportarOrcadoRealizado(c, { proposta: tps.oficial.id, de: '2026-01', ate: '2026-03' }, 'xlsx', comDeps()));
    expect(x.nome).toBe('orcado-realizado-TP-X01_2026-2026-01-a-2026-03.xlsx');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.bytes) as unknown as ArrayBuffer);
    const linhas: string[] = [];
    wb.worksheets[0]!.eachRow((r) => linhas.push((r.values as unknown[]).slice(1).map((v) => String(v ?? '')).join('|')));
    expect(linhas.some((l) => l.startsWith('4.1.1.5.005|Material de escritório|0|0|—|2000|1500|75,00%|500|650|130,00%|2500|2150|350|86,00%'))).toBe(true);
    expect(linhas.some((l) => l.includes('Contas de pessoal: ocultas para o perfil'))).toBe(true);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'CONSULTA' } })).toBe(consultas);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.oxr', tipoOperacao: 'EXPORTACAO' } })).toBe(exportacoes + 1);

    const pdf = exigirOk(await exportarOrcadoRealizado(c, { proposta: tps.oficial.id, de: '2026-01', ate: '2026-03' }, 'pdf', comDeps()));
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const longo = await exportarOrcadoRealizado(c, { proposta: tps.oficial.id, de: '2026-01', ate: '2026-07' }, 'pdf', comDeps());
    expect(!longo.ok && longo.erros[0]!.mensagem).toMatch(/^Para o PDF, escolha um período de até 6 meses/);
    const semTp = await exportarOrcadoRealizado(c, { proposta: '' }, 'xlsx', comDeps());
    expect(!semTp.ok && semTp.erros[0]!.mensagem).toBe('Selecione um Termo de Parceria para consultar.');
    await expect(exportarOrcadoRealizado(ctx(gfin, [tps.oficial.unidadeId], OXR), { proposta: tps.oficial.id }, 'xlsx', comDeps())).rejects.toThrow();
  });
});
