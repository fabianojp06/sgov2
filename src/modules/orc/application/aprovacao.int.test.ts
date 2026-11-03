import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, CONTAS_EXEMPLO, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto, type NoConta } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { aprovarExercicio, enviarParaAprovacao, listarTramites, rejeitarExercicio } from './aprovacao';
import { recalcular, recalcularExercicio } from './calculo-linhas';
import { resolverDeps, type DepsOrc } from './deps';
import { importarPlanilha } from './importacao';
import { linhaPessoal, montarPlanilha } from './planilhas-teste';
import { incluirReceita } from './receitas';
import { definirTeto } from './teto';

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

// Envio, aprovação, rejeição e oficialização (US-061; C36; plano do P6, Task 8).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ano = 2030;
let gfinId: string;
let direxId: string;

const pessoa = async (login: string) =>
  (await migrator.usuario.create({ data: { nome: `Nome ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
const ctx = (usuarioId: string, permissoes: string[]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'u', sessaoUid: 's1', ip: null, unidadeId: null, permissoes: new Set(permissoes) });
const GFIN = () => ctx(gfinId, ['orc.aprovacao:consultar', 'orc.aprovacao:executar', 'orc.orcamento:alterar', 'orc.receitas:incluir', 'orc.importacao:executar']);
const DIREX = () => ctx(direxId, ['orc.aprovacao:consultar', 'orc.aprovacao:aprovar']);

function marcarInativo(no: NoCentroCusto, classificacao: string): NoCentroCusto {
  return { ...no, ativo: no.classificacao === classificacao ? false : no.ativo, filhos: no.filhos.map((f) => marcarInativo(f, classificacao)) };
}

// Exercício em elaboração, com uma posição e um pacote calculados e uma receita confirmada.
async function exercicio() {
  const a = ano++;
  const custo = custoPessoalFalso([premissasExemplo(a)]);
  const base: Partial<DepsOrc> = { cliente: app, estrutura: estruturaFinanceiraFalsa(), custoPessoal: custo, obterEscopo: async () => null };
  const e = await migrator.orcamentoExercicio.create({ data: { ano: a } });
  await migrator.posicaoOrcada.create({ data: { exercicioId: e.id, cc: '4.4', cargo: 'Analista', quantidade: 1, salarioMensal: '5000.00', mesInicio: 1, mesSaida: 12, origem: 'IMPORTACAO' } });
  await migrator.pacoteBaseZero.create({
    data: { exercicioId: e.id, cc: '4.3.0', conta: '4.1.1.5.005', justificativa: 'Reposição de material', prioridade: 'ESSENCIAL', quantidade: 1, valorUnitario: '1200.00', corrigirIpca: false, distribuicao: 'MENSAL', origem: 'IMPORTACAO' },
  });
  await migrator.receitaRateio.create({ data: { exercicioId: e.id, tp: '001', descricao: '', situacao: 'CONFIRMADO', meses: Array(12).fill('10000.00'), total: '120000.00' } });
  await app.$transaction((tx) => recalcularExercicio(tx, e.id, resolverDeps(base)));
  await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
  const versao = async () => (await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } })).versao;
  return { ...e, ano: a, custo, versao, deps: (d: Partial<DepsOrc> = {}) => ({ ...base, ...d }) };
}
const situacao = async (id: string) => (await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id } })).situacao;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  gfinId = await pessoa('gfin');
  direxId = await pessoa('direx');
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

describe('enviarParaAprovacao', () => {
  it('Em Elaboração → Em Aprovação, com remetente, trâmite e Histórico; depois disso, nada muda', async () => {
    const e = await exercicio();
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: String(await e.versao()) }, e.deps())).toEqual({ ok: true, valor: { ano: e.ano } });
    const ex = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } });
    expect(ex).toMatchObject({ situacao: 'EM_APROVACAO', enviadoPor: gfinId });
    expect(await listarTramites(GFIN(), e.id, e.deps())).toEqual([expect.objectContaining({ de: 'Em Elaboração', para: 'Em Aprovação', usuario: 'Nome gfin' })]);
    const h = await migrator.historicoOperacao.findFirstOrThrow({ where: { funcionalidade: 'orc.aprovacao', registroId: e.id } });
    expect(h).toMatchObject({ unidadeId: null });
    // Em Aprovação, recalcular, teto e receita são recusados.
    expect((await recalcular(GFIN(), e.id, e.deps())).ok).toBe(false);
    expect((await definirTeto(GFIN(), { exercicioId: e.id, versao: String(ex.versao), teto: '10' }, e.deps())).ok).toBe(false);
    expect((await incluirReceita(GFIN(), { exercicioId: e.id, tp: '002', situacao: 'Confirmado' }, e.deps())).ok).toBe(false);
    expect(await importarPlanilha(GFIN(), { exercicioId: e.id, arquivo: await montarPlanilha({ pessoal: [linhaPessoal('4.4')] }) }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Aprovação.' }],
    });
    await expect(app.$executeRaw`INSERT INTO orc_posicao (exercicio_id, cc, cargo, quantidade, salario_mensal, mes_inicio, mes_saida, origem)
      VALUES (${e.id}::uuid, '4.4', 'X', 1, 10, 1, 12, 'IMPORTACAO')`).rejects.toThrow(/orc\.exercicio_nao_editavel/);
  });

  it('envio com a versão de antes de um recálculo: concorrência', async () => {
    const e = await exercicio();
    const antes = String(await e.versao());
    expect((await recalcular(GFIN(), e.id, e.deps())).ok).toBe(true);
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: antes }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
  });

  it('premissas desatualizadas (Review Focus 4), exercício vazio, CC inativo (R2) e Rascunho: recusados', async () => {
    const e = await exercicio();
    const v = String(await e.versao());
    const outra = custoPessoalFalso([{ ...premissasExemplo(e.ano), versao: 9 }]);
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: v }, e.deps({ custoPessoal: outra }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.' }],
    });
    const inativa = estruturaFinanceiraFalsa({ centrosCusto: CENTROS_CUSTO_EXEMPLO.map((n) => marcarInativo(n, '4.4')) });
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: v }, e.deps({ estrutura: inativa }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'CC 4.4 ou conta 4.1.1.1.001 não é mais analítico ativo: reimporte a planilha antes de enviar.' }],
    });
    // Conta que deixou de ser analítica ativa (R2), com o CC ativo: também recusa.
    const inativarConta = (n: NoConta): NoConta => ({ ...n, ativa: n.classificacao === '4.1.1.1.001' ? false : n.ativa, filhos: n.filhos.map(inativarConta) });
    const contaInativa = estruturaFinanceiraFalsa({ contas: CONTAS_EXEMPLO.map(inativarConta) });
    const r = await enviarParaAprovacao(GFIN(), { id: e.id, versao: v }, e.deps({ estrutura: contaInativa }));
    expect(r.ok ? '' : r.erros[0]?.mensagem).toMatch(/^CC [\d.]+ ou conta 4\.1\.1\.1\.001 não é mais analítico ativo/);
    const vazio = await migrator.orcamentoExercicio.create({ data: { ano: 2090, versaoPremissas: 1 } });
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${vazio.id}::uuid`;
    expect(await enviarParaAprovacao(GFIN(), { id: vazio.id, versao: '0' }, e.deps({ custoPessoal: custoPessoalFalso([premissasExemplo(2090)]) }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'O orçamento não tem lançamentos para enviar.' }],
    });
    const rascunho = await migrator.orcamentoExercicio.create({ data: { ano: 2091 } });
    expect(await enviarParaAprovacao(GFIN(), { id: rascunho.id, versao: '0' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Rascunho.' }],
    });
    expect(await situacao(e.id)).toBe('EM_ELABORACAO');
  });

  it('Review Focus 4 até o fim: premissas novas recusam o envio; depois do Recalcular, o envio passa', async () => {
    const e = await exercicio();
    const outra = custoPessoalFalso([{ ...premissasExemplo(e.ano), versao: 9 }]);
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: String(await e.versao()) }, e.deps({ custoPessoal: outra }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.' }],
    });
    expect((await recalcular(GFIN(), e.id, e.deps({ custoPessoal: outra }))).ok).toBe(true);
    expect((await enviarParaAprovacao(GFIN(), { id: e.id, versao: String(await e.versao()) }, e.deps({ custoPessoal: outra }))).ok).toBe(true);
    expect(await situacao(e.id)).toBe('EM_APROVACAO');
  });

  it('teto manual sem justificativa que ficou acima da receita (receita reduzida depois): recusado', async () => {
    const e = await exercicio();
    await migrator.orcamentoExercicio.update({ where: { id: e.id }, data: { tetoManual: '100000.00' } });
    await migrator.receitaRateio.updateMany({ where: { exercicioId: e.id }, data: { meses: Array(12).fill('1000.00'), total: '12000.00' } });
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: String(await e.versao()) }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: 'justificativa', mensagem: 'Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres.' }],
    });
  });

  it('§10.2: DIREX enviando, escopo, versão velha, auditoria falhando e campo blindado', async () => {
    const e = await exercicio();
    const v = String(await e.versao());
    await expect(enviarParaAprovacao(DIREX(), { id: e.id, versao: v }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(enviarParaAprovacao(GFIN(), { id: e.id, versao: v }, e.deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    expect(await enviarParaAprovacao(GFIN(), { id: e.id, versao: '99' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }],
    });
    await expect(enviarParaAprovacao(GFIN(), { id: e.id, versao: v, situacao: 'OFICIALIZADO' }, e.deps())).rejects.toEqual(expect.objectContaining({ codigo: 'orc.violacao_governanca' }));
    falhaAuditoria.ligada = true;
    await expect(enviarParaAprovacao(GFIN(), { id: e.id, versao: v }, e.deps())).rejects.toThrow('auditoria indisponível');
    expect(await situacao(e.id)).toBe('EM_ELABORACAO');
  });
});

async function enviado() {
  const e = await exercicio();
  await enviarParaAprovacao(GFIN(), { id: e.id, versao: String(await e.versao()) }, e.deps());
  return e;
}

describe('aprovarExercicio', () => {
  it('DIREX aprova: Oficializado, snapshot com o conteúdo, premissas congeladas, trâmite; nada muda depois', async () => {
    const e = await enviado();
    expect(await aprovarExercicio(DIREX(), { id: e.id, versao: String(await e.versao()) }, e.deps())).toEqual({ ok: true, valor: { ano: e.ano } });
    const ex = await migrator.orcamentoExercicio.findUniqueOrThrow({ where: { id: e.id } });
    expect(ex.situacao).toBe('OFICIALIZADO');
    expect(ex.oficializadoEm).not.toBeNull();
    const snap = await migrator.snapshotExercicio.findUniqueOrThrow({ where: { exercicioId: e.id } });
    const c = snap.conteudo as {
      ano: number;
      painel: { orcado: string; tetoPadrao: string; resultadoAno: string };
      premissas: { congelado: boolean; encargos: unknown[] };
      totaisPorCc: { cc: string; total: string }[];
      linhas: unknown[];
      receitas: unknown[];
      posicoes: unknown[];
    };
    expect(c.ano).toBe(e.ano);
    expect(c.painel.orcado).toBe('61200.00'); // 60.000,00 (posição no falso) + 1.200,00 (pacote)
    expect(c.painel.tetoPadrao).toBe('120000.00');
    expect(c.painel.resultadoAno).toBe('58800.00');
    expect(c.linhas).toHaveLength(2);
    expect(c.posicoes).toHaveLength(1);
    expect(c.receitas).toHaveLength(1);
    expect(c.premissas.congelado).toBe(true); // premissas guardadas já congeladas
    expect(c.premissas.encargos).toHaveLength(5);
    // §6.2: as sintéticas calculadas: 4 (raiz) = 61.200,00; 4.3 = o pacote de 4.3.0.
    expect(c.totaisPorCc.find((t) => t.cc === '4')?.total).toBe('61200.00');
    expect(c.totaisPorCc.find((t) => t.cc === '4.3')?.total).toBe('1200.00');
    // Um UPDATE no exercício oficializado é recusado pelo banco.
    await expect(app.$executeRaw`UPDATE orc_exercicio SET versao = versao + 1 WHERE id = ${e.id}::uuid`).rejects.toThrow(/orc\.exercicio_oficializado/);
    expect(snap.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.custo.congelados.has(e.ano)).toBe(true);
    expect((await listarTramites(DIREX(), e.id, e.deps())).map((t) => t.para)).toEqual(['Em Aprovação', 'Oficializado']);
    await expect(app.$executeRaw`UPDATE orc_snapshot SET sha256 = ${'0'.repeat(64)} WHERE exercicio_id = ${e.id}::uuid`).rejects.toThrow(/permission denied/);
    expect((await rejeitarExercicio(DIREX(), { id: e.id, versao: String(ex.versao), justificativa: 'Mais de quinze letras' }, e.deps())).ok).toBe(false);
  });

  it('D-P6-3: quem enviou não aprova, mesmo com o perfil DIREX', async () => {
    const e = await enviado();
    const ambos = ctx(gfinId, ['orc.aprovacao:executar', 'orc.aprovacao:aprovar']);
    expect(await aprovarExercicio(ambos, { id: e.id, versao: String(await e.versao()) }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Quem enviou o orçamento para aprovação não pode aprová-lo.' }],
    });
    expect(await situacao(e.id)).toBe('EM_APROVACAO');
    // Sem remetente gravado, ninguém aprova: o banco nem deixa o exercício Em Aprovação sem ele
    // (orc_exercicio_enviado_check); a recusa do caso de uso fica como segunda barreira.
    await migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_ELABORACAO' WHERE id = ${e.id}::uuid`;
    await expect(
      migrator.$executeRaw`UPDATE orc_exercicio SET situacao = 'EM_APROVACAO', enviado_por = NULL WHERE id = ${e.id}::uuid`,
    ).rejects.toThrow(/orc_exercicio_enviado_check/);
    expect(await situacao(e.id)).toBe('EM_ELABORACAO');
  });

  it('falha ao congelar as premissas: nada muda (situação, snapshot e trâmite desfeitos)', async () => {
    const e = await enviado();
    const quebra = { ...e.custo, congelarPremissasExercicio: async () => { throw new Error('C2 fora do ar'); } };
    await expect(aprovarExercicio(DIREX(), { id: e.id, versao: String(await e.versao()) }, e.deps({ custoPessoal: quebra }))).rejects.toThrow('C2 fora do ar');
    expect(await situacao(e.id)).toBe('EM_APROVACAO');
    expect(await migrator.snapshotExercicio.count({ where: { exercicioId: e.id } })).toBe(0);
    expect(await migrator.tramiteExercicio.count({ where: { exercicioId: e.id } })).toBe(1);
  });

  it('corrida com as premissas (R10): outra versão depois do congelamento → mensagem e nada muda', async () => {
    const e = await enviado();
    // A versão muda só na leitura feita DEPOIS do congelamento: prova a ordem congelar → reler.
    let congelou = false;
    const corrida = {
      ...e.custo,
      congelarPremissasExercicio: async (...args: Parameters<typeof e.custo.congelarPremissasExercicio>) => {
        congelou = true;
        return e.custo.congelarPremissasExercicio(...args);
      },
      obterPremissasExercicio: async (tx: Parameters<typeof e.custo.obterPremissasExercicio>[0], a: number) => {
        const p = await e.custo.obterPremissasExercicio(tx, a);
        return congelou && p ? { ...p, versao: p.versao + 1 } : p;
      },
    };
    expect(await aprovarExercicio(DIREX(), { id: e.id, versao: String(await e.versao()) }, e.deps({ custoPessoal: corrida }))).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'As premissas do exercício mudaram durante a aprovação. Tente novamente.' }],
    });
    expect(await situacao(e.id)).toBe('EM_APROVACAO');
    expect(await migrator.snapshotExercicio.count({ where: { exercicioId: e.id } })).toBe(0);
  });

  it('§10.2: GFIN aprovando, escopo, duas aprovações simultâneas e auditoria falhando', async () => {
    const e = await enviado();
    const v = String(await e.versao());
    await expect(aprovarExercicio(GFIN(), { id: e.id, versao: v }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(aprovarExercicio(DIREX(), { id: e.id, versao: v }, e.deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    falhaAuditoria.ligada = true;
    await expect(aprovarExercicio(DIREX(), { id: e.id, versao: v }, e.deps())).rejects.toThrow('auditoria indisponível');
    falhaAuditoria.ligada = false;
    expect(await situacao(e.id)).toBe('EM_APROVACAO');
    const rs = await Promise.all([aprovarExercicio(DIREX(), { id: e.id, versao: v }, e.deps()), aprovarExercicio(DIREX(), { id: e.id, versao: v }, e.deps())]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Este registro foi alterado por outro usuário. Recarregue a tela.' }] });
  });
});

describe('rejeitarExercicio', () => {
  it('justificativa curta recusada; com 15 caracteres: Em Elaboração, justificativa no trâmite e a edição volta', async () => {
    const e = await enviado();
    const v = String(await e.versao());
    expect(await rejeitarExercicio(DIREX(), { id: e.id, versao: v, justificativa: '  catorze letra ' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: 'justificativa', mensagem: 'A justificativa da rejeição precisa ter pelo menos 15 caracteres.' }],
    });
    expect((await rejeitarExercicio(DIREX(), { id: e.id, versao: v, justificativa: 'Rever o quadro de pessoal' }, e.deps())).ok).toBe(true);
    expect(await situacao(e.id)).toBe('EM_ELABORACAO');
    expect((await listarTramites(GFIN(), e.id, e.deps())).at(-1)).toMatchObject({ para: 'Em Elaboração', justificativa: 'Rever o quadro de pessoal', usuario: 'Nome direx' });
    expect((await recalcular(GFIN(), e.id, e.deps())).ok).toBe(true);
  });

  it('GFIN rejeitando, escopo e listar trâmites com escopo: ErroPermissao', async () => {
    const e = await enviado();
    await expect(rejeitarExercicio(GFIN(), { id: e.id, versao: '0', justificativa: 'Mais de quinze letras' }, e.deps())).rejects.toBeInstanceOf(ErroPermissao);
    await expect(rejeitarExercicio(DIREX(), { id: e.id, versao: '0', justificativa: 'Mais de quinze letras' }, e.deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
    await expect(listarTramites(DIREX(), e.id, e.deps({ obterEscopo: async () => '4.3' }))).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('rejeição fora de Em Aprovação: mensagem da situação; auditoria falhando: nada muda', async () => {
    const e = await exercicio();
    expect(await rejeitarExercicio(DIREX(), { id: e.id, versao: String(await e.versao()), justificativa: 'Mais de quinze letras' }, e.deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Este exercício não pode ser alterado na situação Em Elaboração.' }],
    });
    const enviado2 = await enviado();
    falhaAuditoria.ligada = true;
    await expect(rejeitarExercicio(DIREX(), { id: enviado2.id, versao: String(await enviado2.versao()), justificativa: 'Mais de quinze letras' }, enviado2.deps())).rejects.toThrow('auditoria indisponível');
    expect(await situacao(enviado2.id)).toBe('EM_APROVACAO');
  });
});
