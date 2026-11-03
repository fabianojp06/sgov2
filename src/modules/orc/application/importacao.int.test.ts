import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { falha } from '@/shared/kernel';
import { readFileSync } from 'node:fs';
import { lerPlanilhaSegura } from '@/modules/ger/servidor';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import type { DepsImportacao } from './importacao';
import { importarPlanilha } from './importacao';
import { linhaPacote, linhaPessoal, linhaReceita, montarPlanilha } from './planilhas-teste';

const falhaAuditoria = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/shared/audit', async (original) => {
  const real = await original<typeof import('@/shared/audit')>();
  return {
    ...real,
    auditar: async (...args: Parameters<typeof real.auditar>) => {
      if (falhaAuditoria.ligada) throw new Error('auditoria indisponível');
      return real.auditar(...args);
    },
  };
});

// Importação da planilha-modelo (US-121; plano do P6, Task 4b), com o leitor real do ger e os
// falsos do C1 e do C2. CCs analíticos do falso: 4.3.0, 4.3.2.10, 4.3.2.11 e 4.4.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2030;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const ctx = (permissoes: string[] = ['orc.importacao:executar']): ContextoRequisicao => ({
  usuarioId: USUARIO,
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  permissoes: new Set(permissoes),
});

async function exercicio() {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  return { ...e, deps: (extra: Partial<DepsImportacao> = {}): Partial<DepsImportacao> => ({
    cliente: app,
    estrutura: estruturaFinanceiraFalsa(),
    custoPessoal: custoPessoalFalso([premissasExemplo(a)]),
    obterEscopo: async () => null,
    ...extra,
  }) };
}
const contagem = async (exercicioId: string) => ({
  posicoes: await migrator.posicaoOrcada.count({ where: { exercicioId } }),
  pacotes: await migrator.pacoteBaseZero.count({ where: { exercicioId } }),
  receitas: await migrator.receitaRateio.count({ where: { exercicioId } }),
  linhas: await migrator.linhaOrcada.count({ where: { exercicioId } }),
});

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
});

beforeEach(() => {
  falhaAuditoria.ligada = false;
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('importarPlanilha: sucesso', () => {
  it('2 posições em 2 CCs, 3 pacotes e 2 receitas: gravados, recalculados, um evento no Histórico', async () => {
    const e = await exercicio();
    const arquivo = await montarPlanilha({
      pessoal: [linhaPessoal('4.4'), linhaPessoal('4.3.0')],
      pacotes: [linhaPacote('4.4'), linhaPacote('4.4'), linhaPacote('4.3.0', { Distribuição: 'Pontual', 'Mês (se pontual)': 7 })],
      receitas: [linhaReceita('001/2026'), linhaReceita('002/2026', { Situação: 'Previsto' })],
    });
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo }, e.deps());
    expect(r.ok && r.valor).toMatchObject({ posicoes: 2, pacotes: 3, ccs: 2, receitas: 2, mensagem: 'Planilha importada: 2 posições e 3 pacotes em 2 CCs, 2 receitas.' });
    expect(r.ok && r.valor.resumoPorCc.map((c) => [c.cc, c.posicoes, c.pacotes])).toEqual([
      ['4.3.0', 1, 1],
      ['4.4', 1, 2],
    ]);
    expect(await contagem(e.id)).toEqual({ posicoes: 2, pacotes: 3, receitas: 2, linhas: 5 });
    const imp = await migrator.importacaoPlanilha.findFirstOrThrow({ where: { exercicioId: e.id } });
    expect(imp).toMatchObject({ arquivoNome: 'orcamento-2027.xlsx', criadoPor: USUARIO });
    expect(imp.arquivoSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await migrator.posicaoOrcada.findFirstOrThrow({ where: { exercicioId: e.id } })).importacaoId).toBe(imp.id);
    const h = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.importacao', registroId: imp.id } });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ tipoOperacao: 'INSERCAO', unidadeId: null });
    expect(JSON.stringify(h[0]!.depois)).not.toContain('7500');
  });

  it('Review Focus 1: coluna cinza com fórmula sem valor e 300 linhas só com fórmula → só as preenchidas, sem erro', async () => {
    const e = await exercicio();
    const arquivo = await montarPlanilha({ pessoal: [linhaPessoal('4.4')], formulasSemValor: true });
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo }, e.deps());
    expect(r.ok).toBe(true);
    expect((await contagem(e.id)).posicoes).toBe(1);
  });
});

describe('importarPlanilha: reimportação (Review Focus 3, R7)', () => {
  it('só os CCs do arquivo são substituídos; o mesmo arquivo duas vezes dá o mesmo estado; receita de outro TP fica', async () => {
    const e = await exercicio();
    const tudo = await montarPlanilha({
      pessoal: [linhaPessoal('4.4'), linhaPessoal('4.3.0')],
      pacotes: [linhaPacote('4.3.0')],
      receitas: [linhaReceita('001/2026'), linhaReceita('002/2026')],
    });
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: tudo }, e.deps());
    const so44 = await montarPlanilha({ pessoal: [linhaPessoal('4.4', { Quantidade: 5 })], receitas: [linhaReceita('001/2026', { Jan: 1 })] });
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: so44 }, e.deps());
    const posicoes = await migrator.posicaoOrcada.findMany({ where: { exercicioId: e.id }, orderBy: { cc: 'asc' } });
    expect(posicoes.map((p) => [p.cc, p.quantidade])).toEqual([
      ['4.3.0', 2],
      ['4.4', 5],
    ]);
    expect(await migrator.pacoteBaseZero.count({ where: { exercicioId: e.id, cc: '4.3.0' } })).toBe(1);
    const receitas = await migrator.receitaRateio.findMany({ where: { exercicioId: e.id }, orderBy: { tp: 'asc' } });
    expect(receitas.map((r) => [r.tp, r.meses[0]!.toString()])).toEqual([
      ['001/2026', '1'],
      ['002/2026', '1000'],
    ]);
    const antes = await contagem(e.id);
    const totais = async () => (await migrator.linhaOrcada.findMany({ where: { exercicioId: e.id }, orderBy: [{ cc: 'asc' }, { conta: 'asc' }] })).map((l) => [l.cc, l.total.toString()]);
    const totaisAntes = await totais();
    const versaoAntes = (await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao;
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: so44 }, e.deps());
    expect(await contagem(e.id)).toEqual(antes);
    expect(await totais()).toEqual(totaisAntes);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao).toBe(versaoAntes + 1);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.importacao' , descricao: { contains: `exercício ${e.ano}` } } })).toBe(3);
  });
});

describe('importarPlanilha: erros (tudo ou nada)', () => {
  it('uma linha com erro entre válidas: nada gravado, relatório só com a linha errada', async () => {
    const e = await exercicio();
    const pessoal = Array.from({ length: 50 }, () => linhaPessoal('4.4'));
    pessoal[20] = linhaPessoal('4.4', { Cargo: null });
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal }) }, e.deps());
    expect(r).toEqual({
      ok: false,
      erros: [
        { campo: '_', mensagem: 'A planilha tem erros. Nada foi importado.' },
        { campo: 'linhas.Pessoal.25.Cargo', mensagem: 'Cargo obrigatório.' },
      ],
    });
    expect(await contagem(e.id)).toEqual({ posicoes: 0, pacotes: 0, receitas: 0, linhas: 0 });
  });

  it('pacote numa conta de pessoal (raízes 4.1.1.1 e 4.1.1.2): conta não permitida e nada gravado', async () => {
    const e = await exercicio();
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pacotes: [linhaPacote('4.4', { 'Conta analítica': '4.1.1.1.001' })] }) }, e.deps());
    expect(r.ok ? [] : r.erros).toContainEqual({ campo: 'linhas.Pacotes base zero.5.Conta analítica', mensagem: 'Conta não permitida em pacote base zero.' });
    expect(await contagem(e.id)).toEqual({ posicoes: 0, pacotes: 0, receitas: 0, linhas: 0 });
  });

  it('erro de célula do leitor (3 casas) aparece uma vez só, sem repetir a validação', async () => {
    const e = await exercicio();
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pacotes: [linhaPacote('4.4', { 'Valor unitário (R$)': 350.123 })] }) }, e.deps());
    expect(r.ok ? [] : r.erros.filter((x) => x.campo.startsWith('linhas.'))).toEqual([
      { campo: 'linhas.Pacotes base zero.5.Valor unitário (R$)', mensagem: 'Número com mais de 2 casas decimais.' },
    ]);
  });

  it('cabeçalho faltando: erro de arquivo com a aba; arquivo que não é xlsx: erro do leitor', async () => {
    const e = await exercicio();
    const sem = await montarPlanilha({ pessoal: [linhaPessoal('4.4')], semColuna: { aba: 'Pessoal', coluna: 'Cargo' } });
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: sem }, e.deps());
    expect(r.ok ? '' : r.erros[0]).toEqual({
      campo: 'arquivo',
      mensagem: expect.stringMatching(/^Planilha fora do layout ADMC-ORC v1\.0: a aba Pessoal precisa do cabeçalho, até a linha 4, com as colunas CC analítico, Cargo,/),
    });
    const lixo = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: { nome: 'x.xlsx', conteudo: new TextEncoder().encode('não sou zip') } }, e.deps());
    expect(lixo.ok).toBe(false);
    expect(await contagem(e.id)).toEqual({ posicoes: 0, pacotes: 0, receitas: 0, linhas: 0 });
  });

  it('planilha sem lançamentos e exercício Em Aprovação', async () => {
    const e = await exercicio();
    expect(await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha() }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'A planilha não tem lançamentos.' }],
    });
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${USUARIO}::uuid WHERE id = ${e.id}::uuid`;
    expect(await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }],
    });
  });

  it('falha do C2 depois da substituição: as posições antigas continuam e nenhuma importação sobra', async () => {
    const e = await exercicio();
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) }, e.deps());
    const custo = custoPessoalFalso([premissasExemplo(e.ano)]);
    let chamadas = 0;
    const quebraNaSegunda = { ...custo, calcularCustoPosicao: (p: Parameters<typeof custo.calcularCustoPosicao>[0], q: Parameters<typeof custo.calcularCustoPosicao>[1]) => (++chamadas === 2 ? falha([{ campo: 'salarioMensal', mensagem: 'Salário inválido.' }]) : custo.calcularCustoPosicao(p, q)) };
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4', { Quantidade: 9 }), linhaPessoal('4.4')] }) }, e.deps({ custoPessoal: quebraNaSegunda }));
    expect(r.ok).toBe(false);
    expect((await migrator.posicaoOrcada.findMany({ where: { exercicioId: e.id } })).map((p) => p.quantidade)).toEqual([2]);
    expect(await migrator.importacaoPlanilha.count({ where: { exercicioId: e.id } })).toBe(1);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.importacao', descricao: { contains: `exercício ${e.ano}` } } })).toBe(1);
  });
});

describe('importarPlanilha: escopo e §10.2', () => {
  it('usuário com escopo 4.3 e a ação: CC 4.4 fora do escopo; aba Receitas recusada', async () => {
    const e = await exercicio();
    const d = e.deps({ obterEscopo: async () => '4.3' });
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.3.0'), linhaPessoal('4.4')] }) }, d);
    expect(r.ok ? [] : r.erros).toContainEqual({ campo: 'linhas.Pessoal.6.CC analítico', mensagem: 'CC fora do seu escopo.' });
    expect(await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.3.0')], receitas: [linhaReceita('001/2026')] }) }, d)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Receitas só podem ser importadas por quem vê toda a Adm. Central.' }],
    });
    expect(await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.3.0')] }) }, d)).toMatchObject({ ok: true });
  });

  it('com escopo e premissas mais novas que o último cálculo: recusa (o recálculo do exercício é da GFIN, R15)', async () => {
    const e = await exercicio();
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) }, e.deps());
    const antes = await contagem(e.id);
    const novas = custoPessoalFalso([{ ...premissasExemplo(e.ano), versao: 2 }]);
    const d = e.deps({ obterEscopo: async () => '4.3', custoPessoal: novas });
    expect(await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.3.0')] }) }, d)).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'As premissas do exercício mudaram depois do último cálculo. Peça à GFIN para recalcular o orçamento antes de importar.' }],
    });
    expect(await contagem(e.id)).toEqual(antes);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versaoPremissas).toBe(1);
    // Sem escopo, a GFIN importa e o recálculo traz a versão nova, registrada no Histórico.
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.3.0')] }) }, e.deps({ custoPessoal: novas }));
    if (!r.ok) throw new Error('esperava sucesso');
    const h = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.importacao', descricao: { contains: `exercício ${e.ano}` } }, orderBy: { id: 'asc' } });
    expect(h.at(-1)).toMatchObject({ antes: { versaoPremissas: 1 }, depois: expect.objectContaining({ versaoPremissas: 2, linhas: 2 }) });
  });

  it('com escopo, erro do cálculo numa posição de CC fora dele: aviso genérico, sem o CC nem o cargo', async () => {
    const e = await exercicio();
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) }, e.deps());
    const custo = custoPessoalFalso([premissasExemplo(e.ano)]);
    // Recusa só a posição já gravada no 4.4 (quantidade 2); a do gestor, no 4.3.0, tem quantidade 3.
    const recusa44 = { ...custo, calcularCustoPosicao: (p: Parameters<typeof custo.calcularCustoPosicao>[0], q: Parameters<typeof custo.calcularCustoPosicao>[1]) => (p.quantidade === 2 ? falha([{ campo: 'salarioMensal', mensagem: 'Componente sem conta.' }]) : custo.calcularCustoPosicao(p, q)) };
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.3.0', { Quantidade: 3 })] }) }, e.deps({ obterEscopo: async () => '4.3', custoPessoal: recusa44 }));
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Há posições de outros centros de custo que não puderam ser calculadas. Avise a GFIN.' }] });
    expect(JSON.stringify(r)).not.toContain('4.4');
  });

  it('sem orc.importacao:executar: ErroPermissao; auditoria falhando: nada gravado', async () => {
    const e = await exercicio();
    const arquivo = await montarPlanilha({ pessoal: [linhaPessoal('4.4')] });
    await expect(importarPlanilha(ctx(['orc.importacao:consultar']), { exercicioId: e.id, arquivo }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    falhaAuditoria.ligada = true;
    await expect(importarPlanilha(ctx(), { exercicioId: e.id, arquivo }, e.deps())).rejects.toThrow('auditoria indisponível');
    expect(await contagem(e.id)).toEqual({ posicoes: 0, pacotes: 0, receitas: 0, linhas: 0 });
  });

  it('duas importações simultâneas do mesmo exercício: serializadas pela trava, estado igual ao de uma', async () => {
    const e = await exercicio();
    const arquivo = await montarPlanilha({ pessoal: [linhaPessoal('4.4'), linhaPessoal('4.3.0')] });
    // As abas são lidas uma vez com o leitor real e servidas de memória, para as duas importações
    // chegarem juntas à transação (o leitor real atende uma leitura por processo).
    const lidas = new Map<string, Awaited<ReturnType<typeof lerPlanilhaSegura>>>();
    for (const aba of ['Pessoal', 'Pacotes base zero', 'Receitas']) {
      const { COLUNAS_PACOTES, COLUNAS_PESSOAL, COLUNAS_RECEITAS } = await import('../domain/planilha');
      const colunas = aba === 'Pessoal' ? COLUNAS_PESSOAL : aba === 'Receitas' ? COLUNAS_RECEITAS : COLUNAS_PACOTES;
      lidas.set(aba, await lerPlanilhaSegura(arquivo, { aba, colunas, linhaCabecalhoMax: 4 }));
    }
    const lerPlanilha: typeof lerPlanilhaSegura = async (_a, o) => lidas.get(o.aba!)!;
    const [r1, r2] = await Promise.all([
      importarPlanilha(ctx(), { exercicioId: e.id, arquivo }, e.deps({ lerPlanilha })),
      importarPlanilha(ctx(), { exercicioId: e.id, arquivo }, e.deps({ lerPlanilha })),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    // Sem a trava, as duas apagariam antes de a outra gravar e o exercício ficaria com 4 posições.
    expect(await contagem(e.id)).toMatchObject({ posicoes: 2, linhas: 2 });
    expect(await migrator.importacaoPlanilha.count({ where: { exercicioId: e.id } })).toBe(2);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao).toBe(2);
  });

  it('nome do arquivo saneado no registro e no Histórico; mais de 500 erros: relatório com teto', async () => {
    const e = await exercicio();
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')], nome: '../../x\u0007.xlsx' }) }, e.deps());
    expect(r.ok).toBe(true);
    expect((await migrator.importacaoPlanilha.findFirstOrThrow({ where: { exercicioId: e.id } })).arquivoNome).toBe('x.xlsx');
    const ruins = Array.from({ length: 600 }, () => linhaPessoal('4.4', { Cargo: null }));
    const muitos = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: ruins }) }, e.deps());
    expect(muitos.ok ? 0 : muitos.erros.length).toBe(502);
    expect(muitos.ok ? '' : muitos.erros.at(-1)!.mensagem).toBe('E mais 100 erro(s) não listados. Corrija os acima e importe de novo.');
  });

  it('CC presente só em Pacotes também tem as posições substituídas; total do resumo vem do motor', async () => {
    const e = await exercicio();
    await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) }, e.deps());
    const r = await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: await montarPlanilha({ pacotes: [linhaPacote('4.4')] }) }, e.deps());
    expect(await migrator.posicaoOrcada.count({ where: { exercicioId: e.id } })).toBe(0);
    // Pacote 12 × 350,00 com o IPCA das premissas de exemplo (4,5%).
    expect(r.ok && r.valor.resumoPorCc.map((c) => [c.cc, c.total.paraString()])).toEqual([['4.4', '4389.00']]);
  });

  it('a planilha-modelo real (docs/modelos), vazia: lida sem erro de célula, "sem lançamentos"', async () => {
    const e = await exercicio();
    const conteudo = new Uint8Array(readFileSync('docs/modelos/orcamento-adm-central-2027-modelo-v1.0.xlsx'));
    expect(await importarPlanilha(ctx(), { exercicioId: e.id, arquivo: { nome: 'modelo.xlsx', conteudo } }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'A planilha não tem lançamentos.' }],
    });
  });
});
