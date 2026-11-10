import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { calcularCustoPosicao, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, falha } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { enviarParaAprovacao } from './aprovacao';
import type { DepsOrc } from './deps';
import { importarPlanilha } from './importacao';
import { alterarPosicao, excluirPosicao, incluirPosicao, listarPosicoes, opcoesPosicao, previaPosicao } from './posicoes';
import { linhaPessoal, montarPlanilha } from './planilhas-teste';

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

// Posições de pessoal pela tela (US-056; plano do P12, Task 1). CCs analíticos do falso do C1: 4.3.0,
// 4.3.2.10, 4.3.2.11 e 4.4. O Gestor tem escopo 4.3. O custo usa o motor real do cad (C33) com as
// premissas de exemplo, para a prévia e as linhas gravadas virem do mesmo cálculo.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2050;

const USUARIO = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const TUDO = ['orc.posicoes:consultar', 'orc.posicoes:incluir', 'orc.posicoes:alterar', 'orc.posicoes:excluir'];
const ctx = (permissoes: string[] = TUDO): ContextoRequisicao => ({
  usuarioId: USUARIO,
  usuarioRotulo: 'gfin',
  sessaoUid: 's1',
  ip: null,
  unidadeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  permissoes: new Set(permissoes),
});
const CONSULTA = ['orc.posicoes:consultar'];

type Ex = Awaited<ReturnType<typeof exercicio>>;
// Exercício com premissas (versão 1); calculado: versão das premissas já gravada.
async function exercicio(o: { calculado?: boolean } = {}) {
  const a = ano++;
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  if (o.calculado ?? true) await migrator.$executeRaw`UPDATE orc_exercicio SET versao_premissas = 1 WHERE id = ${e.id}::uuid`;
  const deps = (extra: Partial<DepsOrc> & { escopo?: string | null; versaoPremissas?: number } = {}): Partial<DepsOrc> => {
    const { escopo = null, versaoPremissas = 1, ...resto } = extra;
    return {
      cliente: app,
      estrutura: estruturaFinanceiraFalsa(),
      custoPessoal: { ...custoPessoalFalso([{ ...premissasExemplo(a), versao: versaoPremissas }]), calcularCustoPosicao },
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
  cargo: 'Analista de orçamento',
  quantidade: '2',
  salarioMensal: '7.500,00',
  mesInicio: '3',
  mesSaida: '12',
  observacao: '',
  ...extra,
});
const din = (v: { toString(): string }) => Dinheiro.de(v.toString());
const idDe = (r: { ok: boolean; valor?: { id: string } }) => (r.ok && r.valor ? r.valor.id : '');
const posicaoDireta = (exercicioId: string, extra: { cc?: string; origem?: string; salario?: string } = {}) =>
  migrator.posicaoOrcada.create({
    data: { exercicioId, cc: extra.cc ?? '4.4', cargo: 'Assistente', quantidade: 1, salarioMensal: extra.salario ?? '3000.00', mesInicio: 1, mesSaida: 12, origem: extra.origem ?? 'IMPORTACAO' },
  });
const emAprovacao = async (id: string) => {
  await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${id}::uuid`;
  await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = ${USUARIO}::uuid WHERE id = ${id}::uuid`;
};
const CONFLITO = { ok: false, erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }] };

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

describe('incluirPosicao', () => {
  it('as linhas gravadas são as do motor (C33); origem TELA; Histórico com o salário e descrição sem valor; versão do exercício sobe', async () => {
    const e = await exercicio();
    const r = await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps());
    expect(r).toEqual({ ok: true, valor: { id: expect.any(String), ano: e.ano, cc: '4.3.0', mensagem: 'O orçamento foi recalculado.' } });
    const id = idDe(r);
    const p = await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id } });
    expect(p).toMatchObject({ origem: 'TELA', importacaoId: null, versao: 0, quantidade: 2, mesInicio: 3, mesSaida: 12, observacao: null });
    expect(din(p.salarioMensal).paraString()).toBe('7500.00');
    const esperado = calcularCustoPosicao({ quantidade: 2, salarioMensal: Dinheiro.de('7500'), mesInicio: 3, mesSaida: 12 }, premissasExemplo(e.ano));
    if (!esperado.ok) throw new Error('motor recusou');
    const linhas = await migrator.linhaOrcada.findMany({ where: { posicaoId: id } });
    expect(linhas.map((l) => [l.componente, l.conta, l.origem, l.cc, din(l.total).paraString()]).sort()).toEqual(
      esperado.valor.linhas.map((l) => [l.componente, l.conta, 'PESSOAL', '4.3.0', l.total.paraString()]).sort(),
    );
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.posicoes', registroId: id } });
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', unidadeId: null });
    expect(h.depois).toEqual({ cc: '4.3.0', cargo: 'Analista de orçamento', quantidade: 2, salarioMensal: '7500.00', mesInicio: 3, mesSaida: 12, observacao: null });
    // A descrição aparece na lista e no XLSX do Histórico para o Auditor: nunca salário nem valor (D-P12-4).
    expect(h.descricao).toBe(`Posição de pessoal incluída no CC 4.3.0, exercício ${e.ano}`);
    expect(await e.versao()).toBe(1);
  });

  it('erros da validação com os campos do formulário; nada é gravado', async () => {
    const e = await exercicio();
    expect(
      await incluirPosicao(ctx(), { ...dados({ cargo: ' ', quantidade: '0', salarioMensal: '0', mesInicio: '10', mesSaida: '2', observacao: '=SOMA(A1)' }), exercicioId: e.id }, e.deps()),
    ).toEqual({
      ok: false,
      erros: [
        { campo: 'cargo', mensagem: 'Cargo obrigatório.' },
        { campo: 'quantidade', mensagem: 'Quantidade inteira, de 1 a 9.999.' },
        { campo: 'salarioMensal', mensagem: 'Salário maior que zero.' },
        { campo: 'mesInicio', mensagem: 'Mês de início depois do mês de saída.' },
        { campo: 'observacao', mensagem: 'Texto não pode começar com =, + ou @.' },
      ],
    });
    expect(await incluirPosicao(ctx(), { ...dados({ salarioMensal: '7.500.00', cargo: 'x'.repeat(121) }), exercicioId: e.id }, e.deps())).toEqual({
      ok: false,
      erros: [
        { campo: 'cargo', mensagem: 'Cargo com mais de 120 caracteres.' },
        { campo: 'salarioMensal', mensagem: 'Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.' },
      ],
    });
    expect(await incluirPosicao(ctx(), { ...dados({ salarioMensal: '1.000.000,00' }), exercicioId: e.id }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: 'salarioMensal', mensagem: 'Salário mensal precisa ser menor que R$ 1.000.000,00.' }],
    });
    expect(await migrator.posicaoOrcada.count({ where: { exercicioId: e.id } })).toBe(0);
  });

  it('escopo: o Gestor lança na subárvore e não fora dela; a GFIN em qualquer CC', async () => {
    const e = await exercicio();
    expect((await incluirPosicao(ctx(), { ...dados({ cc: '4.3.2.11' }), exercicioId: e.id }, gestor(e))).ok).toBe(true);
    expect(await incluirPosicao(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, gestor(e))).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: 'CC fora do seu escopo.' }] });
    expect((await incluirPosicao(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, e.deps())).ok).toBe(true);
  });

  it('premissas mudadas: o Gestor é recusado; a GFIN grava e recalcula o exercício inteiro, com a versão das premissas no Histórico', async () => {
    const e = await exercicio();
    const outra = await posicaoDireta(e.id); // sem linhas: só o recálculo do exercício as cria
    expect(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, gestor(e, { versaoPremissas: 2 }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'As premissas do exercício mudaram. Peça à GFIN para recalcular o orçamento antes de lançar.' }],
    });
    const r = await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps({ versaoPremissas: 2 }));
    expect(r.ok).toBe(true);
    expect(await migrator.linhaOrcada.count({ where: { posicaoId: outra.id } })).toBeGreaterThan(0);
    expect((await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versaoPremissas).toBe(2);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.posicoes', registroId: idDe(r) } });
    expect(h.antes).toEqual({ versaoPremissas: 1 });
    expect(h.depois).toMatchObject({ versaoPremissas: 2, salarioMensal: '7500.00' });
  });

  it('erro do motor na própria posição: erro de campo, nada gravado; erro de outro lançamento no recálculo inteiro: o aviso da posição', async () => {
    const e = await exercicio();
    const base = custoPessoalFalso([{ ...premissasExemplo(e.ano), versao: 2 }]);
    const recusaTudo = { ...base, calcularCustoPosicao: () => falha([{ campo: 'salarioMensal', mensagem: 'Salário abaixo do mínimo.' }]) };
    expect(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps({ custoPessoal: recusaTudo }))).toEqual({
      ok: false,
      erros: [{ campo: 'salarioMensal', mensagem: 'Salário abaixo do mínimo.' }],
    });
    await migrator.posicaoOrcada.create({
      data: { exercicioId: e.id, cc: '4.4', cargo: 'Analista', quantidade: 1, salarioMensal: '100.00', mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' },
    });
    // Recusa só o salário de 100,00 (a outra posição); a nova passa.
    const recusaOutra = {
      ...base,
      calcularCustoPosicao: ((p, pr) =>
        p.salarioMensal.paraString() === '100.00' ? falha([{ campo: 'salarioMensal', mensagem: 'Salário abaixo do mínimo.' }]) : calcularCustoPosicao(p, pr)) as typeof calcularCustoPosicao,
    };
    const r = await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps({ custoPessoal: recusaOutra }));
    expect(r).toEqual({
      ok: false,
      erros: [
        { campo: '_', mensagem: 'A posição não foi gravada: o recálculo do orçamento encontrou erro em outro lançamento do exercício.' },
        { campo: expect.stringMatching(/^posicoes\./), mensagem: 'CC 4.4, cargo Analista: Salário abaixo do mínimo.' },
      ],
    });
    expect(await migrator.posicaoOrcada.count({ where: { exercicioId: e.id, origem: 'TELA' } })).toBe(0);
  });

  it('exercício Em Aprovação: mensagem da situação (incluir, alterar, excluir e prévia)', async () => {
    const e = await exercicio();
    const p = await posicaoDireta(e.id);
    await emAprovacao(e.id);
    const recusa = { ok: false, erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }] };
    expect(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps())).toEqual(recusa);
    expect(await alterarPosicao(ctx(), { ...dados(), id: p.id, versao: '0' }, e.deps())).toEqual(recusa);
    expect(await excluirPosicao(ctx(), { id: p.id, versao: '0' }, e.deps())).toEqual(recusa);
    expect(await previaPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps())).toEqual(recusa);
    expect((await listarPosicoes(ctx(), e.id, e.deps())).editavel).toBe(false);
  });
});

describe('alterarPosicao e excluirPosicao', () => {
  it('altera com a versão; versão velha → conflito; antes e depois com o salário no Histórico; exclusão leva as linhas', async () => {
    const e = await exercicio();
    const id = idDe(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    const r = await alterarPosicao(ctx(), { ...dados({ salarioMensal: '8.000,00', mesSaida: '6', observacao: 'Contratação prevista' }), id, versao: '0' }, e.deps());
    expect(r).toEqual({ ok: true, valor: { id, ano: e.ano, cc: '4.3.0', mensagem: 'O orçamento foi recalculado.' } });
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id } })).toMatchObject({ versao: 1, mesSaida: 6, observacao: 'Contratação prevista', origem: 'TELA' });
    const linhas = await migrator.linhaOrcada.findMany({ where: { posicaoId: id } });
    expect(linhas.every((l) => l.meses.slice(6).every((m) => din(m).ehZero()))).toBe(true);
    expect(await alterarPosicao(ctx(), { ...dados(), id, versao: '0' }, e.deps())).toEqual(CONFLITO);
    expect(await excluirPosicao(ctx(), { id, versao: '0' }, e.deps())).toEqual(CONFLITO);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.posicoes', registroId: id, tipoOperacao: 'ALTERACAO' } });
    expect(h.antes).toMatchObject({ salarioMensal: '7500.00', mesSaida: 12 });
    expect(h.depois).toMatchObject({ salarioMensal: '8000.00', mesSaida: 6 });
    expect(h.descricao).toBe(`Posição de pessoal alterada no CC 4.3.0, exercício ${e.ano}`);
    expect(await excluirPosicao(ctx(), { id, versao: '1' }, e.deps())).toEqual({ ok: true, valor: { id, ano: e.ano, cc: '4.3.0', mensagem: 'O orçamento foi recalculado.' } });
    expect(await migrator.linhaOrcada.count({ where: { posicaoId: id } })).toBe(0);
    const x = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.posicoes', registroId: id, tipoOperacao: 'EXCLUSAO' } });
    expect(x.antes).toMatchObject({ salarioMensal: '8000.00' });
  });

  it('dois salvamentos concorrentes com a mesma versão: um grava, o outro recebe o conflito', async () => {
    const e = await exercicio();
    const id = idDe(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    const rs = await Promise.all([
      alterarPosicao(ctx(), { ...dados({ quantidade: '4' }), id, versao: '0' }, e.deps()),
      alterarPosicao(ctx(), { ...dados({ quantidade: '5' }), id, versao: '0' }, e.deps()),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual(CONFLITO);
  });

  it('escopo forjado: id de outra diretoria → "Posição não encontrada."; trocar o CC para fora do escopo → recusado', async () => {
    const e = await exercicio();
    const deFora = await posicaoDireta(e.id, { cc: '4.4' });
    for (const chamada of [
      () => alterarPosicao(ctx(), { ...dados(), id: deFora.id, versao: '0' }, gestor(e)),
      () => excluirPosicao(ctx(), { id: deFora.id, versao: '0' }, gestor(e)),
      () => alterarPosicao(ctx(), { ...dados(), id: '00000000-0000-4000-8000-000000000000', versao: '0' }, gestor(e)),
      () => excluirPosicao(ctx(), { id: 'nao-e-uuid', versao: '0' }, gestor(e)),
    ]) {
      await expect(chamada()).rejects.toEqual(expect.objectContaining({ codigo: 'orc.posicao_inexistente', message: 'Posição não encontrada.' }));
    }
    const minha = idDe(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, gestor(e)));
    expect(await alterarPosicao(ctx(), { ...dados({ cc: '4.4' }), id: minha, versao: '0' }, gestor(e))).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: 'CC fora do seu escopo.' }] });
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: minha } })).toMatchObject({ cc: '4.3.0', versao: 0 });
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: deFora.id } })).toMatchObject({ cc: '4.4', versao: 0 });
  });

  it('posição importada ou copiada alterada pela tela mantém a origem; a exclusão sempre pode (CC fora da estrutura)', async () => {
    const e = await exercicio();
    const importada = await posicaoDireta(e.id);
    const copiada = await posicaoDireta(e.id, { origem: 'COPIA' });
    expect((await alterarPosicao(ctx(), { ...dados({ cc: '4.4' }), id: importada.id, versao: '0' }, e.deps())).ok).toBe(true);
    expect((await alterarPosicao(ctx(), { ...dados({ cc: '4.4' }), id: copiada.id, versao: '0' }, e.deps())).ok).toBe(true);
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: importada.id } })).toMatchObject({ origem: 'IMPORTACAO', versao: 1 });
    expect(await migrator.posicaoOrcada.findUniqueOrThrow({ where: { id: copiada.id } })).toMatchObject({ origem: 'COPIA', versao: 1 });
    const inativa = await posicaoDireta(e.id, { cc: '9.9' });
    expect((await excluirPosicao(ctx(), { id: inativa.id, versao: '0' }, e.deps())).ok).toBe(true);
  });

  it('o envio para aprovação com a versão de antes de uma posição alterada recebe o conflito', async () => {
    const e = await exercicio();
    const id = idDe(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    const antes = String(await e.versao());
    expect((await alterarPosicao(ctx(), { ...dados({ quantidade: '9' }), id, versao: '0' }, e.deps())).ok).toBe(true);
    expect(await enviarParaAprovacao(ctx(['orc.aprovacao:executar']), { id: e.id, versao: antes }, e.deps())).toEqual(CONFLITO);
  });
});

describe('reimportação da planilha (D-P12-7)', () => {
  it('substitui as posições IMPORTACAO (mesmo alteradas) e COPIA do CC; as da tela ficam, com o aviso e a contagem no Histórico', async () => {
    const e = await exercicio();
    const daTela = idDe(await incluirPosicao(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, e.deps()));
    const importada = await posicaoDireta(e.id);
    await alterarPosicao(ctx(), { ...dados({ cc: '4.4' }), id: importada.id, versao: '0' }, e.deps());
    const copia = await posicaoDireta(e.id, { origem: 'COPIA' });
    const r = await importarPlanilha(
      ctx(['orc.importacao:executar']),
      { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) },
      e.deps(),
    );
    expect(r.ok).toBe(true);
    expect(r.ok ? r.valor.mensagem : '').toBe('Planilha importada: 1 posições e 0 pacotes em 1 CCs, 0 receitas. O CC 4.4 mantém 1 posição(ões) lançada(s) pela tela.');
    const restantes = await migrator.posicaoOrcada.findMany({ where: { exercicioId: e.id } });
    expect(restantes.map((p) => p.origem).sort()).toEqual(['IMPORTACAO', 'TELA']);
    expect(restantes.some((p) => p.id === daTela)).toBe(true);
    expect(restantes.some((p) => p.id === importada.id || p.id === copia.id)).toBe(false);
    expect(await migrator.linhaOrcada.count({ where: { posicaoId: daTela } })).toBeGreaterThan(0);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.importacao', descricao: { contains: `exercício ${e.ano}` } } });
    expect(h.depois).toMatchObject({ mantidosDaTela: [{ cc: '4.4', pacotes: 0, posicoes: 1 }] });
  });
});

describe('listarPosicoes, opcoesPosicao e previaPosicao', () => {
  it('quem lança vê salário e anual; quem só consulta (Auditor, DIREX) recebe os dois nulos; o Gestor vê só o escopo', async () => {
    const e = await exercicio();
    await incluirPosicao(ctx(), { ...dados({ quantidade: '1' }), exercicioId: e.id }, e.deps());
    await posicaoDireta(e.id, { cc: '4.4' });
    const doGestor = await listarPosicoes(ctx(), e.id, gestor(e));
    expect(doGestor.posicoes.map((p) => p.cc)).toEqual(['4.3.0']);
    expect(doGestor.veSalario).toBe(true);
    expect(doGestor.posicoes[0]!.salarioMensal?.paraString()).toBe('7500.00');
    const linhas = await migrator.linhaOrcada.findMany({ where: { posicaoId: doGestor.posicoes[0]!.id } });
    expect(doGestor.posicoes[0]!.valorAnual?.paraString()).toBe(Dinheiro.somarTodos(linhas.map((l) => din(l.total))).paraString());
    const consulta = await listarPosicoes(ctx(CONSULTA), e.id, e.deps());
    expect(consulta.veSalario).toBe(false);
    expect(consulta.posicoes.map((p) => p.cc)).toEqual(['4.3.0', '4.4']);
    expect(consulta.posicoes.every((p) => p.salarioMensal === null && p.valorAnual === null)).toBe(true);
    expect(JSON.stringify(consulta)).not.toMatch(/7500|3000/);
    await expect(listarPosicoes(ctx([]), e.id, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('opções: CCs analíticos do escopo e a situação do exercício', async () => {
    const e = await exercicio();
    const o = await opcoesPosicao(ctx(), e.id, gestor(e));
    expect(o.ccs.map((c) => c.classificacao)).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11']);
    expect(o).toMatchObject({ quantidadeMaxima: 9999, situacao: 'RASCUNHO', editavel: true });
    expect((await opcoesPosicao(ctx(), e.id, e.deps())).ccs.map((c) => c.classificacao)).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11', '4.4']);
  });

  it('prévia = linhas gravadas (mesmo motor, mesmas premissas), sem gravar nem auditar', async () => {
    const e = await exercicio();
    const antes = await migrator.historicoOperacao.count();
    const previa = await previaPosicao(ctx(), { ...dados({ cargo: '' }), exercicioId: e.id }, e.deps());
    expect(previa.ok).toBe(true);
    if (!previa.ok) return;
    expect(await migrator.historicoOperacao.count()).toBe(antes);
    expect(await migrator.posicaoOrcada.count({ where: { exercicioId: e.id } })).toBe(0);
    const id = idDe(await incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps()));
    const linhas = await migrator.linhaOrcada.findMany({ where: { posicaoId: id } });
    const soma = (f: (c: string) => boolean) => Dinheiro.somarTodos(linhas.filter((l) => f(l.componente!)).map((l) => din(l.total))).paraString();
    const v = previa.valor;
    expect(v.anual.paraString()).toBe(soma(() => true));
    expect(v.massa.paraString()).toBe(soma((c) => c === 'salario' || c === 'adicional'));
    expect(v.feriasDecimo.paraString()).toBe(soma((c) => c === 'ferias' || c === 'decimo_terceiro'));
    expect(v.encargos.paraString()).toBe(soma((c) => c.startsWith('encargo.')));
    expect(v.beneficios.paraString()).toBe(soma((c) => c.startsWith('beneficio.')));
    expect(v.massa.somar(v.feriasDecimo).somar(v.encargos).somar(v.beneficios).paraString()).toBe(v.anual.paraString());
    expect(v.aviso).toBeNull();
  });

  it('prévia: só quem inclui ou altera (Auditor recusado); escopo pelo CC; incompleta → erros de campo; Gestor com premissas mudadas recebe o aviso', async () => {
    const e = await exercicio();
    await expect(previaPosicao(ctx(CONSULTA), { ...dados(), exercicioId: e.id }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    expect((await previaPosicao(ctx(['orc.posicoes:consultar', 'orc.posicoes:alterar']), { ...dados(), exercicioId: e.id }, e.deps())).ok).toBe(true);
    expect(await previaPosicao(ctx(), { ...dados({ cc: '4.4' }), exercicioId: e.id }, gestor(e))).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: 'CC fora do seu escopo.' }] });
    expect(await previaPosicao(ctx(), { ...dados({ salarioMensal: '' }), exercicioId: e.id }, e.deps())).toEqual({ ok: false, erros: [{ campo: 'salarioMensal', mensagem: 'Salário maior que zero.' }] });
    const aviso = await previaPosicao(ctx(), { ...dados(), exercicioId: e.id }, gestor(e, { versaoPremissas: 2 }));
    expect(aviso.ok && aviso.valor.aviso).toBe('As premissas do exercício mudaram. Peça à GFIN para recalcular o orçamento antes de lançar.');
    const gfin = await previaPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps({ versaoPremissas: 2 }));
    expect(gfin.ok && gfin.valor.aviso).toBeNull();
    await expect(previaPosicao(ctx(), { ...dados(), exercicioId: e.id, origem: 'TELA' }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
  });
});

describe('§10.2: permissão, auditoria e ORIGEM BLINDADA', () => {
  it('DIREX e Auditor (só consultar) não escrevem', async () => {
    const e = await exercicio();
    const p = await posicaoDireta(e.id);
    const consulta = ctx(CONSULTA);
    await expect(incluirPosicao(consulta, { ...dados(), exercicioId: e.id }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(alterarPosicao(consulta, { ...dados(), id: p.id, versao: '0' }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(excluirPosicao(consulta, { id: p.id, versao: '0' }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('auditoria falhando: nada muda', async () => {
    const e = await exercicio();
    const p = await posicaoDireta(e.id);
    falhaAuditoria.ligada = true;
    await expect(incluirPosicao(ctx(), { ...dados(), exercicioId: e.id }, e.deps())).rejects.toThrow('auditoria indisponível');
    await expect(alterarPosicao(ctx(), { ...dados(), id: p.id, versao: '0' }, e.deps())).rejects.toThrow('auditoria indisponível');
    await expect(excluirPosicao(ctx(), { id: p.id, versao: '0' }, e.deps())).rejects.toThrow('auditoria indisponível');
    falhaAuditoria.ligada = false;
    expect(await migrator.posicaoOrcada.findMany({ where: { exercicioId: e.id } })).toEqual([expect.objectContaining({ id: p.id, versao: 0, cc: '4.4' })]);
    expect(await migrator.linhaOrcada.count({ where: { exercicioId: e.id } })).toBe(0);
    expect(await e.versao()).toBe(0);
  });

  it('origem, importação, exercício e linhas no payload: recusado e auditado', async () => {
    const e = await exercicio();
    const p = await posicaoDireta(e.id);
    for (const campo of ['origem', 'importacaoId', 'linhas']) {
      await expect(incluirPosicao(ctx(), { ...dados(), exercicioId: e.id, [campo]: '1' }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    }
    await expect(alterarPosicao(ctx(), { ...dados(), id: p.id, versao: '0', exercicioId: e.id }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    await expect(excluirPosicao(ctx(), { id: p.id, versao: '0', origem: 'TELA' }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.posicoes', tipoOperacao: 'SISTEMA', descricao: { startsWith: 'Tentativa de gravar campo de origem blindada' } } })).toBeGreaterThanOrEqual(5);
    expect(await migrator.posicaoOrcada.count({ where: { exercicioId: e.id } })).toBe(1);
  });

  it('o banco recusa posição da tela apontando para importação', async () => {
    const e = await exercicio();
    const imp = await migrator.importacaoPlanilha.create({ data: { exercicioId: e.id, arquivoNome: 'x.xlsx', arquivoSha256: 'a'.repeat(64), resumo: {}, criadoPor: USUARIO } });
    await expect(
      migrator.posicaoOrcada.create({
        data: { exercicioId: e.id, cc: '4.4', cargo: 'X', quantidade: 1, salarioMensal: '10.00', mesInicio: 1, mesSaida: 1, origem: 'TELA', importacaoId: imp.id },
      }),
    ).rejects.toThrow(/orc_posicao_tela_check/);
  });
});
