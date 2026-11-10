import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, falha, Percentual } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { calcularPacote } from '../domain/pacote';
import { enviarParaAprovacao } from './aprovacao';
import type { DepsOrc } from './deps';
import { importarPlanilha } from './importacao';
import { alterarPacote, excluirPacote, incluirPacote, listarPacotes, opcoesPacote } from './pacotes';
import { linhaPacote, montarPlanilha } from './planilhas-teste';

const falhaAuditoria = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/shared/audit', async (original) => {
  const real = await original<typeof import('@/shared/audit')>();
  return {
    ...real,
    auditar: async (...args: Parameters<typeof real.auditar>) => {
      if (falhaAuditoria.ligada && args[1].tipo !== 'SISTEMA') throw new Error('auditoria indisponível');
      return real.auditar(...args);
    },
  };
});

// Pacotes base zero pela tela (US-057; plano do P11, Task 1). CCs analíticos do falso do C1: 4.3.0,
// 4.3.2.10, 4.3.2.11 e 4.4; a única conta permitida em pacote é 4.1.1.5.005 (as 4.1.1.1/4.1.1.2 são
// de pessoal). O Gestor tem escopo 4.3.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2040;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const TUDO = ['orc.pacotes:consultar', 'orc.pacotes:incluir', 'orc.pacotes:alterar', 'orc.pacotes:excluir'];
const ctx = (permissoes: string[] = TUDO): ContextoRequisicao => ({
  usuarioId: USUARIO,
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  permissoes: new Set(permissoes),
});

type Ex = Awaited<ReturnType<typeof exercicio>>;
// Exercício com premissas (versão 1, IPCA 4,5%); calculado: versão das premissas já gravada.
async function exercicio(o: { calculado?: boolean } = {}) {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  if (o.calculado ?? true) await migrator.$executeRaw`UPDATE orc_exercicio SET versao_premissas = 1 WHERE id = ${e.id}::uuid`;
  const deps = (extra: Partial<DepsOrc> & { escopo?: string | null; versaoPremissas?: number } = {}): Partial<DepsOrc> => {
    const { escopo = null, versaoPremissas = 1, ...resto } = extra;
    return {
      cliente: app,
      estrutura: estruturaFinanceiraFalsa(),
      custoPessoal: custoPessoalFalso([{ ...premissasExemplo(a), versao: versaoPremissas }]),
      obterEscopo: async () => escopo,
      ...resto,
    };
  };
  const versao = async () => (await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao;
  return { ...e, deps, versao };
}
const gestor = (e: Ex, extra: Parameters<Ex['deps']>[0] = {}) => e.deps({ escopo: '4.3', ...extra });
const dados = (extra: Record<string, string> = {}) => ({
  cc: '4.3.0',
  conta: '4.1.1.5.005',
  justificativa: 'Reposição anual de material de escritório',
  prioridade: 'Importante',
  quantidade: '3',
  valorUnitario: '1.234,57',
  corrigirIpca: 'Sim',
  distribuicao: 'Mensal',
  mesOcorrencia: '',
  ...extra,
});
const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const idDe = (r: { ok: boolean; valor?: { id: string } }) => (r.ok && r.valor ? r.valor.id : '');
const linha = (pacoteId: string) => migrator.linhaOrcada.findFirstOrThrow({ where: { pacoteId } });
const pacoteDireto = (exercicioId: string, extra: { cc?: string; conta?: string; origem?: string } = {}) =>
  migrator.pacoteBaseZero.create({
    data: {
      exercicioId, cc: extra.cc ?? '4.4', conta: extra.conta ?? '4.1.1.5.005', justificativa: 'Pacote gravado direto no teste', prioridade: 'ESSENCIAL',
      quantidade: 1, valorUnitario: '100.00', corrigirIpca: false, distribuicao: 'MENSAL', mesOcorrencia: null, origem: extra.origem ?? 'IMPORTACAO',
    },
  });
// Oficializado exige snapshot e trâmite (R10): a mesma editavel() decide; o teste usa Em Aprovação.
const emAprovacao = async (id: string) => {
  await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${id}::uuid`;
  await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${USUARIO}::uuid WHERE id = ${id}::uuid`;
};

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

describe('incluirPacote', () => {
  it('mensal com IPCA: a linha é a de calcularPacote, as 12 parcelas fecham o anual (centavos em dezembro); origem TELA; Histórico; versão do exercício sobe', async () => {
    const e = await exercicio();
    const r = await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps());
    expect(r).toEqual({ ok: true, valor: { id: expect.any(String), ano: e.ano, cc: '4.3.0', mensagem: 'O orçamento foi recalculado.' } });
    const id = idDe(r);
    const k = await migrator.pacoteBaseZero.findUniqueOrThrow({ where: { id } });
    expect(k).toMatchObject({ origem: 'TELA', importacaoId: null, versao: 0, quantidade: 3, corrigirIpca: true, distribuicao: 'MENSAL', prioridade: 'IMPORTANTE' });
    const esperado = calcularPacote(
      { quantidade: 3, valorUnitario: Dinheiro.de('1234.57'), corrigirIpca: true, distribuicao: 'MENSAL', mesOcorrencia: null },
      Percentual.dePontos('4.5'),
    );
    const l = await linha(id);
    expect(din(l.total).paraString()).toBe('3870.38'); // 3.703,71 × 1,045 = 3.870,37695
    expect(l.meses.map((m) => din(m).paraString())).toEqual(esperado.meses.map((m) => m.paraString()));
    expect(Dinheiro.somarTodos(l.meses.map(din)).paraString()).toBe('3870.38');
    expect(din(l.meses[11]!).paraString()).not.toBe(din(l.meses[0]!).paraString());
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.pacotes', registroId: id } });
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', unidadeId: null });
    expect(h.depois).toMatchObject({ cc: '4.3.0', conta: '4.1.1.5.005', quantidade: 3, valorUnitario: '1234.57', corrigirIpca: true, distribuicao: 'MENSAL', mesOcorrencia: null });
    expect(await e.versao()).toBe(1);
  });

  it('pontual sem IPCA: o anual inteiro no mês de ocorrência', async () => {
    const e = await exercicio();
    const r = await incluirPacote(ctx(), { ...dados({ corrigirIpca: 'Não', distribuicao: 'Pontual', mesOcorrencia: '7', quantidade: '2', valorUnitario: '500' }), exercicioId: e.id }, e.deps());
    const l = await linha(idDe(r));
    expect(l.meses.map((m) => din(m).paraString())).toEqual(Array.from({ length: 12 }, (_, i) => (i === 6 ? '1000.00' : '0.00')));
    expect(din(l.total).paraString()).toBe('1000.00');
  });

  it('erros da validação com os campos do formulário; conta de pessoal e de premissa recusadas (formulário forjado)', async () => {
    const e = await exercicio();
    expect(await incluirPacote(ctx(), { ...dados({ justificativa: 'curta', quantidade: '0', valorUnitario: '0', distribuicao: 'Pontual' }), exercicioId: e.id }, e.deps())).toEqual({
      ok: false,
      erros: [
        { campo: 'justificativa', mensagem: 'Justificativa com menos de 10 caracteres.' },
        { campo: 'quantidade', mensagem: 'Quantidade inteira, de 1 a 9.999.' },
        { campo: 'valorUnitario', mensagem: 'Valor unitário maior que zero.' },
        { campo: 'mesOcorrencia', mensagem: 'Informe um mês de 1 a 12.' },
      ],
    });
    for (const conta of ['4.1.1.1.001', '4.1.1.2.001', '4.1.1.8.003', '']) {
      expect(await incluirPacote(ctx(), { ...dados({ conta }), exercicioId: e.id }, e.deps())).toEqual({
        ok: false,
        erros: [{ campo: 'conta', mensagem: 'Conta não permitida em pacote base zero.' }],
      });
    }
    expect(await migrator.pacoteBaseZero.count({ where: { exercicioId: e.id } })).toBe(0);
  });

  it('escopo: o Gestor lança na subárvore e não fora dela; a GFIN em qualquer CC', async () => {
    const e = await exercicio();
    expect((await incluirPacote(ctx(), { ...dados({ cc: '4.3.2.11' }), exercicioId: e.id }, gestor(e))).ok).toBe(true);
    expect(await incluirPacote(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, gestor(e))).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: 'CC fora do seu escopo.' }] });
    expect((await incluirPacote(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, e.deps())).ok).toBe(true);
  });

  it('premissas mudadas: o Gestor é recusado; a GFIN grava e recalcula o exercício inteiro, com a versão das premissas no Histórico', async () => {
    const e = await exercicio();
    const outro = await pacoteDireto(e.id); // sem linhas: só o recálculo do exercício as cria
    expect(await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, gestor(e, { versaoPremissas: 2 }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'As premissas do exercício mudaram. Peça à GFIN para recalcular o orçamento antes de lançar.' }],
    });
    const r = await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps({ versaoPremissas: 2 }));
    expect(r.ok).toBe(true);
    expect(await migrator.linhaOrcada.count({ where: { pacoteId: outro.id } })).toBe(1);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versaoPremissas).toBe(2);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.pacotes', registroId: idDe(r) } });
    expect(h.antes).toEqual({ versaoPremissas: 1 });
    expect(h.depois).toMatchObject({ versaoPremissas: 2 });
  });

  it('exercício nunca calculado: o Gestor também grava, com o exercício recalculado', async () => {
    const e = await exercicio({ calculado: false });
    expect((await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, gestor(e))).ok).toBe(true);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versaoPremissas).toBe(1);
  });

  it('recálculo do exercício inteiro barrado por erro de outro lançamento: nada é gravado, com o aviso', async () => {
    const e = await exercicio();
    await migrator.posicaoOrcada.create({
      data: { exercicioId: e.id, cc: '4.4', cargo: 'Analista', quantidade: 1, salarioMensal: '100.00', mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' },
    });
    const custo = custoPessoalFalso([{ ...premissasExemplo(e.ano), versao: 2 }]);
    const recusa = { ...custo, calcularCustoPosicao: () => falha([{ campo: 'salarioMensal', mensagem: 'Salário abaixo do mínimo.' }]) };
    const r = await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps({ custoPessoal: recusa }));
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.erros[1]?.mensagem).toBe('CC 4.4, cargo Analista: Salário abaixo do mínimo.');
    expect(r.ok ? [] : r.erros[0]).toEqual({ campo: '_', mensagem: 'O pacote não foi gravado: o recálculo do orçamento encontrou erro em outro lançamento do exercício.' });
    expect(await migrator.pacoteBaseZero.count({ where: { exercicioId: e.id } })).toBe(0);
  });

  it('exercício Em Aprovação: mensagem da situação (incluir, alterar e excluir)', async () => {
    const e = await exercicio();
    const k = await pacoteDireto(e.id);
    await emAprovacao(e.id);
    const recusa = { ok: false, erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }] };
    expect(await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps())).toEqual(recusa);
    expect(await alterarPacote(ctx(), { ...dados(), id: k.id, versao: '0' }, e.deps())).toEqual(recusa);
    expect(await excluirPacote(ctx(), { id: k.id, versao: '0' }, e.deps())).toEqual(recusa);
    expect((await listarPacotes(ctx(), e.id, e.deps())).editavel).toBe(false);
  });
});

describe('alterarPacote e excluirPacote', () => {
  it('altera para pontual com a versão; versão velha → conflito; antes e depois no Histórico', async () => {
    const e = await exercicio();
    const id = idDe(await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    const r = await alterarPacote(ctx(), { ...dados({ distribuicao: 'Pontual', mesOcorrencia: '3', corrigirIpca: 'Não' }), id, versao: '0' }, e.deps());
    expect(r).toEqual({ ok: true, valor: { id, ano: e.ano, cc: '4.3.0', mensagem: 'O orçamento foi recalculado.' } });
    expect(await migrator.pacoteBaseZero.findUniqueOrThrow({ where: { id } })).toMatchObject({ versao: 1, distribuicao: 'PONTUAL', mesOcorrencia: 3, origem: 'TELA' });
    const l = await linha(id);
    expect(din(l.meses[2]!).paraString()).toBe('3703.71');
    expect(await migrator.linhaOrcada.count({ where: { pacoteId: id } })).toBe(1);
    expect(await alterarPacote(ctx(), { ...dados(), id, versao: '0' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    expect(await excluirPacote(ctx(), { id, versao: '0' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.pacotes', registroId: id, tipoOperacao: 'ALTERACAO' } });
    expect(h.antes).toMatchObject({ distribuicao: 'MENSAL', mesOcorrencia: null, corrigirIpca: true });
    expect(h.depois).toMatchObject({ distribuicao: 'PONTUAL', mesOcorrencia: 3, corrigirIpca: false });
    expect(await excluirPacote(ctx(), { id, versao: '1' }, e.deps())).toEqual({ ok: true, valor: { id, ano: e.ano, cc: '4.3.0', mensagem: 'O orçamento foi recalculado.' } });
    expect(await migrator.linhaOrcada.count({ where: { pacoteId: id } })).toBe(0);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.pacotes', registroId: id, tipoOperacao: 'EXCLUSAO' } })).toBe(1);
  });

  it('dois salvamentos concorrentes com a mesma versão: um grava, o outro recebe o conflito', async () => {
    const e = await exercicio();
    const id = idDe(await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    const rs = await Promise.all([
      alterarPacote(ctx(), { ...dados({ quantidade: '4' }), id, versao: '0' }, e.deps()),
      alterarPacote(ctx(), { ...dados({ quantidade: '5' }), id, versao: '0' }, e.deps()),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }] });
  });

  it('escopo forjado: id de outra diretoria → "Pacote não encontrado."; trocar o CC para fora do escopo → recusado', async () => {
    const e = await exercicio();
    const deFora = await pacoteDireto(e.id, { cc: '4.4' });
    for (const chamada of [
      () => alterarPacote(ctx(), { ...dados(), id: deFora.id, versao: '0' }, gestor(e)),
      () => excluirPacote(ctx(), { id: deFora.id, versao: '0' }, gestor(e)),
      () => alterarPacote(ctx(), { ...dados(), id: '00000000-0000-4000-8000-000000000000', versao: '0' }, gestor(e)),
    ]) {
      await expect(chamada()).rejects.toEqual(expect.objectContaining({ codigo: 'orc.pacote_inexistente', message: 'Pacote não encontrado.' }));
    }
    const meu = idDe(await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, gestor(e)));
    expect(await alterarPacote(ctx(), { ...dados({ cc: '4.4' }), id: meu, versao: '0' }, gestor(e))).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: 'CC fora do seu escopo.' }] });
    expect(await migrator.pacoteBaseZero.findUniqueOrThrow({ where: { id: meu } })).toMatchObject({ cc: '4.3.0', versao: 0 });
    expect(await migrator.pacoteBaseZero.findUniqueOrThrow({ where: { id: deFora.id } })).toMatchObject({ cc: '4.4', versao: 0 });
  });

  it('pacote importado alterado pela tela continua IMPORTACAO; conta que virou vetada exige troca; a exclusão sempre pode', async () => {
    const e = await exercicio();
    const importado = await pacoteDireto(e.id);
    expect((await alterarPacote(ctx(), { ...dados({ cc: '4.4', conta: '4.1.1.5.005' }), id: importado.id, versao: '0' }, e.deps())).ok).toBe(true);
    expect(await migrator.pacoteBaseZero.findUniqueOrThrow({ where: { id: importado.id } })).toMatchObject({ origem: 'IMPORTACAO', versao: 1 });
    const vetado = await pacoteDireto(e.id, { conta: '4.1.1.1.001' });
    expect(await alterarPacote(ctx(), { ...dados({ cc: '4.4', conta: '4.1.1.1.001' }), id: vetado.id, versao: '0' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: 'conta', mensagem: 'Conta não permitida em pacote base zero.' }],
    });
    const inativo = await pacoteDireto(e.id, { cc: '9.9', conta: '4.9.9.9.999' });
    expect((await excluirPacote(ctx(), { id: vetado.id, versao: '0' }, e.deps())).ok).toBe(true);
    expect((await excluirPacote(ctx(), { id: inativo.id, versao: '0' }, e.deps())).ok).toBe(true);
  });

  it('o envio para aprovação com a versão de antes de um pacote alterado recebe o conflito', async () => {
    const e = await exercicio();
    const id = idDe(await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    const antes = String(await e.versao());
    expect((await alterarPacote(ctx(), { ...dados({ quantidade: '9' }), id, versao: '0' }, e.deps())).ok).toBe(true);
    expect(await enviarParaAprovacao(ctx(['orc.aprovacao:executar']), { id: e.id, versao: antes }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
  });
});

describe('reimportação da planilha (D-P11-7)', () => {
  it('substitui os pacotes IMPORTACAO (mesmo alterados pela tela) e COPIA do CC; os da tela ficam, com o aviso', async () => {
    const e = await exercicio();
    const daTela = idDe(await incluirPacote(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, e.deps()));
    const importado = await pacoteDireto(e.id);
    await alterarPacote(ctx(), { ...dados({ cc: '4.4' }), id: importado.id, versao: '0' }, e.deps());
    const copia = await pacoteDireto(e.id, { origem: 'COPIA' });
    const r = await importarPlanilha(
      ctx(['orc.importacao:executar']),
      { exercicioId: e.id, arquivo: await montarPlanilha({ pacotes: [linhaPacote('4.4')] }) },
      e.deps(),
    );
    expect(r.ok).toBe(true);
    expect(r.ok ? r.valor.mensagem : '').toBe('Planilha importada: 0 posições e 1 pacotes em 1 CCs, 0 receitas. O CC 4.4 mantém 1 pacote(s) lançado(s) pela tela.');
    const restantes = await migrator.pacoteBaseZero.findMany({ where: { exercicioId: e.id } });
    expect(restantes.map((k) => k.origem).sort()).toEqual(['IMPORTACAO', 'TELA']);
    expect(restantes.some((k) => k.id === daTela)).toBe(true);
    expect(restantes.some((k) => k.id === importado.id || k.id === copia.id)).toBe(false);
    expect(await migrator.linhaOrcada.count({ where: { pacoteId: daTela } })).toBe(1);
  });
});

describe('§10.2: permissão, auditoria e ORIGEM BLINDADA', () => {
  it('DIREX e Auditor (só consultar) não escrevem', async () => {
    const e = await exercicio();
    const k = await pacoteDireto(e.id);
    const consulta = ctx(['orc.pacotes:consultar']);
    await expect(incluirPacote(consulta, { ...dados(), exercicioId: e.id }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(alterarPacote(consulta, { ...dados(), id: k.id, versao: '0' }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(excluirPacote(consulta, { id: k.id, versao: '0' }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(listarPacotes(ctx([]), e.id, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('auditoria falhando: nada muda', async () => {
    const e = await exercicio();
    const k = await pacoteDireto(e.id);
    falhaAuditoria.ligada = true;
    await expect(incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps())).rejects.toThrow('auditoria indisponível');
    await expect(alterarPacote(ctx(), { ...dados(), id: k.id, versao: '0' }, e.deps())).rejects.toThrow('auditoria indisponível');
    await expect(excluirPacote(ctx(), { id: k.id, versao: '0' }, e.deps())).rejects.toThrow('auditoria indisponível');
    falhaAuditoria.ligada = false;
    expect(await migrator.pacoteBaseZero.findMany({ where: { exercicioId: e.id } })).toEqual([expect.objectContaining({ id: k.id, versao: 0, cc: '4.4' })]);
    expect(await migrator.linhaOrcada.count({ where: { exercicioId: e.id } })).toBe(0);
    expect(await e.versao()).toBe(0);
  });

  it('origem, importação, exercício e valores calculados no payload: recusado e auditado', async () => {
    const e = await exercicio();
    const k = await pacoteDireto(e.id);
    for (const campo of ['origem', 'importacaoId', 'valorAnual', 'meses', 'linhas']) {
      await expect(incluirPacote(ctx(), { ...dados(), exercicioId: e.id, [campo]: '1' }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    }
    await expect(alterarPacote(ctx(), { ...dados(), id: k.id, versao: '0', exercicioId: e.id }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    await expect(excluirPacote(ctx(), { id: k.id, versao: '0', origem: 'TELA' }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.pacotes', tipoOperacao: 'SISTEMA', descricao: { startsWith: 'Tentativa de gravar campo de origem blindada' } } })).toBeGreaterThanOrEqual(7);
    expect(await migrator.pacoteBaseZero.count({ where: { exercicioId: e.id } })).toBe(1);
  });
});

describe('listarPacotes e opcoesPacote', () => {
  it('o Gestor vê só os CCs do escopo; a GFIN vê tudo, inclusive CC fora da estrutura ativa', async () => {
    const e = await exercicio();
    await incluirPacote(ctx(), { ...dados(), exercicioId: e.id }, e.deps());
    await pacoteDireto(e.id, { cc: '4.4' });
    await pacoteDireto(e.id, { cc: '9.9' });
    const doGestor = await listarPacotes(ctx(), e.id, gestor(e));
    expect(doGestor.pacotes.map((k) => k.cc)).toEqual(['4.3.0']);
    expect(doGestor.pacotes[0]).toMatchObject({ origem: 'TELA', versao: 0 });
    expect(doGestor.pacotes[0]!.valorAnual.paraString()).toBe('3870.38');
    expect(doGestor.editavel).toBe(true);
    expect((await listarPacotes(ctx(), e.id, e.deps())).pacotes.map((k) => k.cc)).toEqual(['4.3.0', '4.4', '9.9']);
  });

  it('opções: CCs analíticos do escopo, só contas permitidas e o IPCA do exercício', async () => {
    const e = await exercicio();
    const o = await opcoesPacote(ctx(), e.id, gestor(e));
    expect(o.ccs.map((c) => c.classificacao)).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11']);
    expect(o.contas).toEqual([{ classificacao: '4.1.1.5.005', descricao: 'Material de escritório' }]);
    expect(o).toMatchObject({ ipca: '4.5000', situacao: 'RASCUNHO', editavel: true });
    expect((await opcoesPacote(ctx(), e.id, e.deps())).ccs.map((c) => c.classificacao)).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11', '4.4']);
    expect((await opcoesPacote(ctx(), e.id, e.deps({ custoPessoal: custoPessoalFalso([]) }))).ipca).toBeNull();
  });
});

