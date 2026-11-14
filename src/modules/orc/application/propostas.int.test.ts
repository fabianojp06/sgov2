import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, ErroDominio } from '@/shared/kernel';
import { aplicarUnidades } from '@/shared/unidade';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { DepsOrc } from './deps';
import { ccsLivresParaTp, criarProposta, dadosParaDuplicar, duplicarProposta, excluirProposta, listarPropostas, novaVersaoProposta } from './propostas';

// Proposta de TP: capa, Versão 1 e CC próprio (US-065; plano do P17, Task 1). Como sgo_app (RLS real).
// O falso do C1 ainda não tem a raiz 9 dos TPs (a frente B vai acrescentar): aqui, a árvore do falso
// ganha 9 (sintético), 9.1 e 9.2 (analíticos) e 9.3 (analítico inativo), só neste teste.
let falharAuditoria = false;
// Roda antes do próximo auditar (uma vez): simula outra sessão mexendo na origem no meio da duplicação.
let antesDeAuditar: (() => Promise<void>) | null = null;
vi.mock('@/shared/audit', async (original) => {
  const m = await original<typeof import('@/shared/audit')>();
  return {
    ...m,
    auditar: async (...args: Parameters<typeof m.auditar>) => {
      if (falharAuditoria) throw new Error('falha simulada da auditoria');
      const gancho = antesDeAuditar;
      antesDeAuditar = null;
      if (gancho) await gancho();
      return m.auditar(...args);
    },
  };
});

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const no = (classificacao: string, descricao: string, analitico: boolean, filhos: NoCentroCusto[] = [], ativo = true): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `90.${classificacao}`,
  descricao,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: analitico ? 'ANALITICO' : 'SINTETICO',
  ativo,
  deGestao: false,
  natureza: null,
  provisorio: true,
  filhos,
});
const RAIZ_TPS = no('9', 'Termos de Parceria', false, [
  no('9.1', 'TP de exemplo 1', true),
  no('9.2', 'TP de exemplo 2', true),
  no('9.3', 'TP de exemplo 3 (inativo)', true, [], false),
]);
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
// O falso com a raiz 9 é o C1 inteiro: o resolverDeps o põe em estruturaCompleta e recorta o deps.estrutura
// à raiz 4 da Adm. Central (C37).
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura });

const TODAS = ['orc.propostas:consultar', 'orc.propostas:incluir', 'orc.propostas:excluir'];
let seq = 0;
let orcamentista: string;
let outro: string;

async function usuario(): Promise<string> {
  const login = `orc${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
// As unidades ativas do usuário, como o provedor de contexto do aut monta a cada requisição.
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId: string, permissoes: string[] = TODAS): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'orcamentista', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}

const numero = () => `TP-${String(++seq).padStart(3, '0')}/2027`;
const capa = (extra: Record<string, unknown> = {}) => ({
  tipo: 'TERMO_PARCERIA',
  numero: numero(),
  objeto: 'Objeto de exemplo do TP',
  parceiro: 'Parceiro Exemplo',
  inicio: '2027-01-01',
  fim: '2027-12-31',
  categoria: 'CONSOLIDADA',
  cc: '9.1',
  ...extra,
});
async function criar(extra: Record<string, unknown> = {}, quem = orcamentista) {
  const dados = capa(extra);
  const r = await criarProposta(await ctx(quem), dados, comDeps());
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return { ...r.valor, dados };
}
const contagens = async (codigo: string) => ({
  unidades: await migrator.unidade.count({ where: { codigo } }),
  vinculos: await migrator.usuarioUnidade.count({ where: { unidade: { codigo } } }),
  propostas: await migrator.propostaTp.count({ where: { unidade: { codigo } } }),
  versoes: await migrator.versaoProposta.count({ where: { unidade: { codigo } } }),
});

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
  outro = await usuario();
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

// Cada teste começa com todos os CCs de TP livres (a árvore do falso só tem 9.1 e 9.2 ativos).
beforeEach(async () => {
  falharAuditoria = false;
  antesDeAuditar = null;
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
});

describe('ccsLivresParaTp', () => {
  it('CCs analíticos ativos sob a raiz 9, menos os de TP ativo; a exclusão libera o CC', async () => {
    expect(await ccsLivresParaTp(await ctx(orcamentista), comDeps())).toEqual([
      { classificacao: '9.1', descricao: 'TP de exemplo 1' },
      { classificacao: '9.2', descricao: 'TP de exemplo 2' },
    ]);
    const p = await criar({ cc: '9.1' });
    expect(await ccsLivresParaTp(await ctx(orcamentista), comDeps())).toEqual([{ classificacao: '9.2', descricao: 'TP de exemplo 2' }]);
    // Outro Orçamentista, sem vínculo com o TP, também vê o 9.1 ocupado (unidade é global, sem RLS).
    expect((await ccsLivresParaTp(await ctx(outro), comDeps())).map((c) => c.classificacao)).toEqual(['9.2']);
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    expect((await ccsLivresParaTp(await ctx(orcamentista), comDeps())).map((c) => c.classificacao)).toEqual(['9.1', '9.2']);
  });

  it('só para quem inclui proposta', async () => {
    await expect(ccsLivresParaTp(await ctx(orcamentista, ['orc.propostas:consultar']), comDeps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('criarProposta', () => {
  it('grava a unidade (código, nome e CC), o vínculo do criador, a capa, a Versão 1 em Rascunho e o Histórico', async () => {
    const objeto = `Objeto ${'x'.repeat(200)}`;
    const p = await criar({ objeto, parceiro: '  ', cc: '9.2' });
    expect(p).toEqual({ id: expect.any(String), unidadeId: expect.any(String), numero: p.dados.numero, dados: expect.anything() });

    const unidade = await migrator.unidade.findUniqueOrThrow({ where: { id: p.unidadeId } });
    expect(unidade).toEqual({ id: p.unidadeId, codigo: p.dados.numero, nome: objeto.slice(0, 120), ativo: true, cc: '9.2' });
    expect(await migrator.usuarioUnidade.findMany({ where: { unidadeId: p.unidadeId } })).toEqual([{ usuarioId: orcamentista, unidadeId: p.unidadeId }]);

    const capaGravada = await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } });
    expect(capaGravada).toMatchObject({ unidadeId: p.unidadeId, tipo: 'TERMO_PARCERIA', objeto, parceiro: null, categoria: 'CONSOLIDADA', criadoPor: orcamentista, excluidaEm: null, versao: 0 });
    expect(capaGravada.inicio.toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(capaGravada.fim.toISOString().slice(0, 10)).toBe('2027-12-31');
    const versoes = await migrator.versaoProposta.findMany({ where: { propostaId: p.id } });
    expect(versoes).toEqual([expect.objectContaining({ unidadeId: p.unidadeId, numero: 1, situacao: 'RASCUNHO', criadoPor: orcamentista })]);

    const [h, ...resto] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.propostas', registroId: p.id } });
    expect(resto).toEqual([]);
    expect(h).toMatchObject({ tipoOperacao: 'INSERCAO', usuarioId: orcamentista, unidadeId: p.unidadeId, descricao: `Proposta do TP ${p.numero} criada em Rascunho, com o CC 9.2` });
    expect(h!.depois).toEqual({
      numero: p.numero,
      tipo: 'TERMO_PARCERIA',
      objeto,
      parceiro: null,
      inicio: '2027-01-01',
      fim: '2027-12-31',
      categoria: 'CONSOLIDADA',
      cc: '9.2',
      versaoAtual: 1,
      situacao: 'RASCUNHO',
    });
    // O vínculo do criador também no Histórico do usuário (D-P17-3).
    // Como na tela de usuários (US-031): o evento do usuário não é de uma unidade; a unidade vai no depois.
    const vinculo = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'adm.usuarios', registroId: orcamentista, descricao: { contains: p.numero } } });
    expect(vinculo).toEqual([expect.objectContaining({ tipoOperacao: 'INSERCAO', unidadeId: null, depois: { unidadeId: p.unidadeId, numero: p.numero } })]);
  });

  it('número repetido (também o de uma proposta excluída) → NUMERO_DUPLICADO, sem erro 500 e sem gravar nada', async () => {
    const p = await criar({ cc: '9.1' });
    const antes = await contagens(p.numero);
    const r = await criarProposta(await ctx(orcamentista), capa({ numero: ` ${p.numero} `, cc: '9.2' }), comDeps());
    expect(r).toEqual({ ok: false, erros: [{ campo: 'numero', mensagem: M.NUMERO_DUPLICADO(p.numero) }] });
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    expect(await criarProposta(await ctx(orcamentista), capa({ numero: p.numero, cc: '9.2' }), comDeps())).toEqual(r);
    expect(await contagens(p.numero)).toEqual(antes);
  });

  it('número que só difere em maiúsculas é o mesmo TP → NUMERO_DUPLICADO; o índice do banco também barra', async () => {
    const p = await criar({ numero: 'TP-MAIUSC/2027', cc: '9.1' });
    expect(await criarProposta(await ctx(orcamentista), capa({ numero: 'tp-maiusc/2027', cc: '9.2' }), comDeps())).toEqual({
      ok: false,
      erros: [{ campo: 'numero', mensagem: M.NUMERO_DUPLICADO('tp-maiusc/2027') }],
    });
    await expect(migrator.unidade.create({ data: { codigo: 'Tp-Maiusc/2027', nome: 'x' } })).rejects.toThrow(/unidade_codigo_maiusculas_key|Unique constraint/);
    expect(p.numero).toBe('TP-MAIUSC/2027');
  });

  it('a criação sobe a versão do criador: a ficha aberta antes na tela de usuários não apaga o vínculo (revisão 12.12)', async () => {
    const antes = (await migrator.usuario.findUniqueOrThrow({ where: { id: orcamentista } })).versao;
    await criar({ cc: '9.1' });
    expect((await migrator.usuario.findUniqueOrThrow({ where: { id: orcamentista } })).versao).toBe(antes + 1);
  });

  it('CC de outro TP ativo → CC_DE_OUTRO_TP', async () => {
    await criar({ cc: '9.1' }, outro);
    const dados = capa({ cc: '9.1' });
    expect(await criarProposta(await ctx(orcamentista), dados, comDeps())).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: M.CC_DE_OUTRO_TP('9.1') }] });
    expect(await contagens(dados.numero)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
  });

  it.each(['4.3.0', '9', '9.3', '9.9'])('CC %s (fora da raiz, sintético, inativo ou inexistente) → CC_INVALIDO_TP', async (cc) => {
    const dados = capa({ cc });
    expect(await criarProposta(await ctx(orcamentista), dados, comDeps())).toEqual({ ok: false, erros: [{ campo: 'cc', mensagem: M.CC_INVALIDO_TP(cc) }] });
    expect(await contagens(dados.numero)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
  });

  it('erros de validação da capa voltam com os campos; nada é gravado', async () => {
    const dados = capa({ fim: '2027-01-15', categoria: '' });
    const r = await criarProposta(await ctx(orcamentista), dados, comDeps());
    expect(r).toEqual({
      ok: false,
      erros: [
        { campo: '_', mensagem: M.PROPOSTA_OBRIGATORIOS },
        { campo: 'categoria', mensagem: M.PROPOSTA_CAMPO_OBRIGATORIO },
        { campo: 'fim', mensagem: M.PROPOSTA_VIGENCIA_CURTA },
      ],
    });
    expect(await contagens(dados.numero)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
    // Campo desconhecido no payload: recusado inteiro.
    expect(await criarProposta(await ctx(orcamentista), { ...capa(), outro: 'x' }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }] });
  });

  it('ORIGEM BLINDADA: Valor Global ou situação no payload → recusado, com a tentativa no Histórico', async () => {
    const dados = capa({ valorGlobal: '1000.00' });
    await expect(criarProposta(await ctx(orcamentista), dados, comDeps())).rejects.toBeInstanceOf(ErroDominio);
    await expect(criarProposta(await ctx(orcamentista), capa({ situacao: 'OFICIALIZADO' }), comDeps())).rejects.toBeInstanceOf(ErroDominio);
    expect(await contagens(dados.numero)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
    const tentativas = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.propostas', tipoOperacao: 'SISTEMA', usuarioId: orcamentista } });
    expect(tentativas.map((t) => t.descricao)).toEqual(expect.arrayContaining([expect.stringContaining('valorGlobal'), expect.stringContaining('situacao')]));
  });

  it('Histórico indisponível no meio da criação → nada fica gravado (nem unidade, nem vínculo, nem capa, nem versão)', async () => {
    falharAuditoria = true;
    const dados = capa({ cc: '9.1' });
    await expect(criarProposta(await ctx(orcamentista), dados, comDeps())).rejects.toThrow('falha simulada da auditoria');
    expect(await contagens(dados.numero)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
    falharAuditoria = false;
    expect((await ccsLivresParaTp(await ctx(orcamentista), comDeps())).map((c) => c.classificacao)).toEqual(['9.1', '9.2']);
  });

  it('sem orc.propostas:incluir → ErroPermissao', async () => {
    await expect(criarProposta(await ctx(orcamentista, ['orc.propostas:consultar', 'orc.propostas:excluir']), capa(), comDeps())).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('corrida: duas criações com o mesmo CC ao mesmo tempo → uma grava, a outra recebe CC_DE_OUTRO_TP, sem nada órfão', async () => {
    const [a, b] = [capa({ cc: '9.2' }), capa({ cc: '9.2' })];
    const [ca, cb] = [await ctx(orcamentista), await ctx(outro)];
    const resultados = await Promise.all([criarProposta(ca, a, comDeps()), criarProposta(cb, b, comDeps())]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, erros: [{ campo: 'cc', mensagem: M.CC_DE_OUTRO_TP('9.2') }] }]);
    const perdedor = resultados[0]!.ok ? b : a;
    expect(await contagens(perdedor.numero)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
    expect(await migrator.unidade.count({ where: { cc: '9.2', ativo: true } })).toBe(1);
  });

  // A conferência antes de gravar não vê a unidade da outra transação ainda aberta: quem decide é o
  // índice único (a gravação espera a outra terminar e recebe a violação). Aqui, a outra transação é
  // segurada aberta de propósito, para o caminho do índice rodar sempre.
  it.each([
    ['CC', { cc: '9.1' }, (d: { numero: string }) => ({ codigo: `${d.numero}-OUTRA`, cc: '9.1' }), () => ({ campo: 'cc', mensagem: M.CC_DE_OUTRO_TP('9.1') })],
    ['número', { cc: '9.2' }, (d: { numero: string }) => ({ codigo: d.numero, cc: null }), (d: { numero: string }) => ({ campo: 'numero', mensagem: M.NUMERO_DUPLICADO(d.numero) })],
  ] as const)('corrida decidida pelo índice único (%s): a outra transação grava primeiro → mensagem, sem nada órfão', async (_, extra, outra, erro) => {
    const dados = capa(extra);
    const contexto = await ctx(orcamentista);
    let pendente!: ReturnType<typeof criarProposta>;
    await migrator.$transaction(async (tx) => {
      await tx.unidade.create({ data: { ...outra(dados), nome: 'Outra transação' } });
      pendente = criarProposta(contexto, dados, comDeps());
      // Tempo para a criação passar da conferência e esperar no índice.
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(await pendente).toEqual({ ok: false, erros: [erro(dados)] });
    expect(await migrator.propostaTp.count({ where: { unidade: { codigo: dados.numero } } })).toBe(0);
    expect(await migrator.usuarioUnidade.count({ where: { unidade: { codigo: dados.numero } } })).toBe(0);
  });

  it('corrida: duas criações com o mesmo número ao mesmo tempo → uma grava, a outra recebe NUMERO_DUPLICADO', async () => {
    const n = numero();
    const resultados = await Promise.all([
      criarProposta(await ctx(orcamentista), capa({ numero: n, cc: '9.1' }), comDeps()),
      criarProposta(await ctx(outro), capa({ numero: n, cc: '9.2' }), comDeps()),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toEqual([{ ok: false, erros: [{ campo: 'numero', mensagem: M.NUMERO_DUPLICADO(n) }] }]);
    expect(await contagens(n)).toEqual({ unidades: 1, vinculos: 1, propostas: 1, versoes: 1 });
  });
});

describe('listarPropostas', () => {
  it('o criador vê a proposta (Rascunho, Versão 1, valor global 0,00); outro usuário sem vínculo vê lista vazia (RLS)', async () => {
    const p = await criar({ cc: '9.1', tipo: 'CONTRATO', categoria: 'META' });
    const lista = await listarPropostas(await ctx(orcamentista), comDeps());
    const minha = lista.find((x) => x.id === p.id);
    expect(minha).toEqual({
      id: p.id,
      numero: p.numero,
      tipo: 'CONTRATO',
      objeto: 'Objeto de exemplo do TP',
      parceiro: 'Parceiro Exemplo',
      inicio: '2027-01-01',
      fim: '2027-12-31',
      categoria: 'META',
      cc: '9.1',
      situacao: 'RASCUNHO',
      versaoAtual: 1,
      excluivel: true,
      valorGlobal: expect.any(Dinheiro),
      valorGlobalSemPessoal: false,
      versao: 0,
    });
    expect(minha!.valorGlobal.paraString()).toBe('0.00');
    expect((await listarPropostas(await ctx(outro), comDeps())).some((x) => x.id === p.id)).toBe(false);
    // Fora do emUnidade, o sgo_app não vê capa nem versão nenhuma.
    expect(await app.propostaTp.count()).toBe(0);
    expect(await app.versaoProposta.count()).toBe(0);
  });

  it('quem só consulta lista; sem consultar → ErroPermissao', async () => {
    await criar({ cc: '9.2' });
    expect((await listarPropostas(await ctx(orcamentista, ['orc.propostas:consultar']), comDeps())).length).toBeGreaterThan(0);
    await expect(listarPropostas(await ctx(orcamentista, ['orc.propostas:incluir']), comDeps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('excluirProposta', () => {
  it('em Rascunho: marca a capa excluída, inativa a unidade, grava EXCLUSAO e some da lista', async () => {
    const p = await criar({ cc: '9.1' });
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: '0' }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero } });
    const capaGravada = await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } });
    expect(capaGravada).toMatchObject({ excluidaPor: orcamentista, versao: 1 });
    expect(capaGravada.excluidaEm).toBeInstanceOf(Date);
    expect(await migrator.unidade.findUniqueOrThrow({ where: { id: p.unidadeId } })).toMatchObject({ ativo: false, cc: '9.1', codigo: p.numero });
    // Os vínculos ficam (histórico, D-P17-10); a versão também.
    expect(await contagens(p.numero)).toEqual({ unidades: 1, vinculos: 1, propostas: 1, versoes: 1 });
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.propostas', registroId: p.id, tipoOperacao: 'EXCLUSAO' } });
    expect(h).toMatchObject({ usuarioId: orcamentista, unidadeId: p.unidadeId, descricao: `Proposta do TP ${p.numero} excluída` });
    expect(h!.antes).toMatchObject({ numero: p.numero, cc: '9.1', situacao: 'RASCUNHO' });
    // Com o contexto de antes (a unidade ainda na lista), a proposta excluída não aparece nem é excluída de novo.
    const antigo = { ...(await ctx(orcamentista)), unidades: [p.unidadeId] };
    expect((await listarPropostas(antigo, comDeps())).some((x) => x.id === p.id)).toBe(false);
    expect(await excluirProposta(antigo, { id: p.id, versao: 1 }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }] });
  });

  it('versão diferente → ALTERADO_POR_OUTRO; usuário sem vínculo ou id inválido → inexistente; nada muda', async () => {
    const p = await criar({ cc: '9.1' });
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 3 }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }] });
    expect(await excluirProposta(await ctx(outro), { id: p.id, versao: 0 }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }] });
    expect(await excluirProposta(await ctx(orcamentista), { id: 'nao-e-uuid', versao: 0 }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }] });
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ excluidaEm: null, versao: 0 });
    expect(await migrator.unidade.findUniqueOrThrow({ where: { id: p.unidadeId } })).toMatchObject({ ativo: true });
  });

  it('fora do Rascunho → PROPOSTA_NAO_EXCLUIVEL (UC 3.07 E2)', async () => {
    const p = await criar({ cc: '9.2' });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'EM_ELABORACAO' WHERE proposta_id = ${p.id}::uuid`;
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_NAO_EXCLUIVEL }] });
    expect(await migrator.unidade.findUniqueOrThrow({ where: { id: p.unidadeId } })).toMatchObject({ ativo: true });
  });

  it('sem orc.propostas:excluir → ErroPermissao', async () => {
    const p = await criar({ cc: '9.2' });
    await expect(excluirProposta(await ctx(orcamentista, ['orc.propostas:consultar', 'orc.propostas:incluir']), { id: p.id, versao: 0 }, comDeps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

// Duplicar e nova versão (US-066; plano do P18, Task 1).
const inexistente = { ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_INEXISTENTE }] };
const alterado = { ok: false, erros: [{ campo: '_', mensagem: M.ALTERADO_POR_OUTRO }] };
const versoesDe = async (propostaId: string) =>
  (await migrator.versaoProposta.findMany({ where: { propostaId }, orderBy: { numero: 'asc' }, select: { numero: true, situacao: true } })).map(
    (v) => `${v.numero}:${v.situacao}`,
  );
// O retrato da origem (capa, versões e Histórico), para conferir que a duplicação não a toca.
const retratoOrigem = async (id: string) => ({
  capa: await migrator.propostaTp.findUniqueOrThrow({ where: { id } }),
  versoes: await migrator.versaoProposta.findMany({ where: { propostaId: id }, orderBy: { numero: 'asc' } }),
  historico: await migrator.historicoOperacao.count({ where: { registroId: id } }),
});
const camposCopia = (extra: Record<string, unknown> = {}) => ({
  tipo: 'CONTRATO',
  objeto: 'Cópia de Objeto de exemplo do TP',
  parceiro: 'Outro Parceiro',
  inicio: '2028-01-01',
  fim: '2028-06-30',
  categoria: 'META',
  ...extra,
});

describe('dadosParaDuplicar', () => {
  it('os campos da origem para o modal, com "Cópia de " no objeto (D-P18-3); inexistente para quem não vê', async () => {
    const o = await criar({ cc: '9.1' });
    expect(await dadosParaDuplicar(await ctx(orcamentista), o.id, comDeps())).toEqual({
      origemId: o.id,
      versaoOrigem: 0,
      numeroOrigem: o.numero,
      tipo: 'TERMO_PARCERIA',
      objeto: 'Cópia de Objeto de exemplo do TP',
      parceiro: 'Parceiro Exemplo',
      inicio: '2027-01-01',
      fim: '2027-12-31',
      categoria: 'CONSOLIDADA',
    });
    expect(await dadosParaDuplicar(await ctx(outro), o.id, comDeps())).toBeNull();
    expect(await dadosParaDuplicar(await ctx(orcamentista), 'nao-e-uuid', comDeps())).toBeNull();
    await expect(dadosParaDuplicar(await ctx(orcamentista, ['orc.propostas:consultar']), o.id, comDeps())).rejects.toBeInstanceOf(ErroPermissao);
    const antigo = { ...(await ctx(orcamentista)), unidades: [o.unidadeId] };
    expect(await excluirProposta(antigo, { id: o.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    expect(await dadosParaDuplicar(antigo, o.id, comDeps())).toBeNull();
  });
});

describe('duplicarProposta', () => {
  it('grava a proposta nova (unidade com número e CC novos, vínculo, capa, V1 em Rascunho e Histórico com a origem); a origem fica intata', async () => {
    const o = await criar({ cc: '9.1' });
    const antes = await retratoOrigem(o.id);
    const novo = numero();
    const r = await duplicarProposta(await ctx(orcamentista), { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.2', ...camposCopia() }, comDeps());
    expect(r).toEqual({ ok: true, valor: { id: expect.any(String), unidadeId: expect.any(String), numero: novo } });
    if (!r.ok) return;
    expect(r.valor.id).not.toBe(o.id);

    expect(await migrator.unidade.findUniqueOrThrow({ where: { id: r.valor.unidadeId } })).toEqual({
      id: r.valor.unidadeId,
      codigo: novo,
      nome: 'Cópia de Objeto de exemplo do TP',
      ativo: true,
      cc: '9.2',
    });
    expect(await migrator.usuarioUnidade.findMany({ where: { unidadeId: r.valor.unidadeId } })).toEqual([{ usuarioId: orcamentista, unidadeId: r.valor.unidadeId }]);
    const capaNova = await migrator.propostaTp.findUniqueOrThrow({ where: { id: r.valor.id } });
    expect(capaNova).toMatchObject({ tipo: 'CONTRATO', objeto: 'Cópia de Objeto de exemplo do TP', parceiro: 'Outro Parceiro', categoria: 'META', versao: 0, criadoPor: orcamentista });
    expect(capaNova.inicio.toISOString().slice(0, 10)).toBe('2028-01-01');
    expect(await versoesDe(r.valor.id)).toEqual(['1:RASCUNHO']);

    const historico = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.propostas', registroId: r.valor.id } });
    expect(historico).toEqual([
      expect.objectContaining({
        tipoOperacao: 'INSERCAO',
        usuarioId: orcamentista,
        unidadeId: r.valor.unidadeId,
        descricao: `Proposta do TP ${novo} duplicada da proposta do TP ${o.numero}`,
      }),
    ]);
    expect(historico[0]!.depois).toEqual({
      numero: novo,
      tipo: 'CONTRATO',
      objeto: 'Cópia de Objeto de exemplo do TP',
      parceiro: 'Outro Parceiro',
      inicio: '2028-01-01',
      fim: '2028-06-30',
      categoria: 'META',
      cc: '9.2',
      versaoAtual: 1,
      situacao: 'RASCUNHO',
      propostaOrigemId: o.id,
      numeroOrigem: o.numero,
    });
    const vinculo = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'adm.usuarios', registroId: orcamentista, descricao: { contains: novo } } });
    expect(vinculo).toEqual([expect.objectContaining({ tipoOperacao: 'INSERCAO', unidadeId: null, depois: { unidadeId: r.valor.unidadeId, numero: novo } })]);

    // A origem não muda: capa, versões e Histórico.
    expect(await retratoOrigem(o.id)).toEqual(antes);
    // As duas na lista de quem duplicou.
    const lista = await listarPropostas(await ctx(orcamentista), comDeps());
    expect(lista.filter((x) => x.id === o.id || x.id === r.valor.id).map((x) => x.numero)).toEqual([o.numero, novo]);
  });

  it('sem os campos opcionais: tipo, objeto (com "Cópia de "), parceiro, datas e categoria vêm da origem', async () => {
    const o = await criar({ cc: '9.1', parceiro: '' });
    const novo = numero();
    const r = await duplicarProposta(await ctx(orcamentista), { origemId: o.id, versaoOrigem: '0', numero: novo, cc: '9.2' }, comDeps());
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: r.valor.id } })).toMatchObject({
      tipo: 'TERMO_PARCERIA',
      objeto: 'Cópia de Objeto de exemplo do TP',
      parceiro: null,
      categoria: 'CONSOLIDADA',
    });
  });

  it('a origem pode estar em qualquer situação (RN_DUP_001)', async () => {
    const o = await criar({ cc: '9.1' });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE proposta_id = ${o.id}::uuid`;
    const r = await duplicarProposta(await ctx(orcamentista), { origemId: o.id, versaoOrigem: 0, numero: numero(), cc: '9.2' }, comDeps());
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(await versoesDe(r.valor.id)).toEqual(['1:RASCUNHO']);
  });

  it('CC da origem ativa → CC_DE_OUTRO_TP; número da origem → NUMERO_DUPLICADO; validação da capa; nada gravado', async () => {
    const o = await criar({ cc: '9.1' });
    const contexto = await ctx(orcamentista);
    const novo = numero();
    expect(await duplicarProposta(contexto, { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.1' }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: 'cc', mensagem: M.CC_DE_OUTRO_TP('9.1') }],
    });
    expect(await duplicarProposta(contexto, { origemId: o.id, versaoOrigem: 0, numero: o.numero, cc: '9.2' }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: 'numero', mensagem: M.NUMERO_DUPLICADO(o.numero) }],
    });
    expect(await duplicarProposta(contexto, { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.2', fim: '2027-01-10' }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: 'fim', mensagem: M.PROPOSTA_VIGENCIA_CURTA }],
    });
    expect(await duplicarProposta(contexto, { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.3' }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: 'cc', mensagem: M.CC_INVALIDO_TP('9.3') }],
    });
    expect(await duplicarProposta(contexto, { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '' }, comDeps())).toMatchObject({ ok: false });
    expect(await contagens(novo)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
    // Campo desconhecido ou origem sem versão: recusado inteiro.
    expect(await duplicarProposta(contexto, { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.2', outro: 'x' }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }],
    });
    expect(await duplicarProposta(contexto, { origemId: o.id, numero: novo, cc: '9.2' }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }] });
  });

  it('origem de outra unidade, excluída ou id inválido → inexistente, sem nada gravado (D-P18-7)', async () => {
    const o = await criar({ cc: '9.1' });
    const novo = numero();
    expect(await duplicarProposta(await ctx(outro), { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.2' }, comDeps())).toEqual(inexistente);
    expect(await duplicarProposta(await ctx(orcamentista), { origemId: 'nao-e-uuid', versaoOrigem: 0, numero: novo, cc: '9.2' }, comDeps())).toEqual(inexistente);
    const antigo = { ...(await ctx(orcamentista)), unidades: [o.unidadeId] };
    expect(await excluirProposta(antigo, { id: o.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    expect(await duplicarProposta(antigo, { origemId: o.id, versaoOrigem: 1, numero: novo, cc: '9.2' }, comDeps())).toEqual(inexistente);
    expect(await contagens(novo)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
  });

  it('versaoOrigem diferente → ALTERADO_POR_OUTRO; a origem mudada no meio da duplicação também, sem nada gravado (RNF_DUP_REQ_003)', async () => {
    const o = await criar({ cc: '9.1' });
    const novo = numero();
    expect(await duplicarProposta(await ctx(orcamentista), { origemId: o.id, versaoOrigem: 5, numero: novo, cc: '9.2' }, comDeps())).toEqual(alterado);
    // Outra sessão cria uma versão da origem (e sobe a versão da capa) enquanto a duplicação grava.
    antesDeAuditar = async () => {
      await migrator.$executeRaw`UPDATE orc_proposta SET versao = versao + 1 WHERE id = ${o.id}::uuid`;
    };
    expect(await duplicarProposta(await ctx(orcamentista), { origemId: o.id, versaoOrigem: 0, numero: novo, cc: '9.2' }, comDeps())).toEqual(alterado);
    expect(antesDeAuditar).toBeNull();
    expect(await contagens(novo)).toEqual({ unidades: 0, vinculos: 0, propostas: 0, versoes: 0 });
    expect((await ccsLivresParaTp(await ctx(orcamentista), comDeps())).map((c) => c.classificacao)).toEqual(['9.2']);
  });

  it('sem orc.propostas:incluir → ErroPermissao (D-P18-6)', async () => {
    const o = await criar({ cc: '9.1' });
    await expect(
      duplicarProposta(await ctx(orcamentista, ['orc.propostas:consultar', 'orc.propostas:excluir']), { origemId: o.id, versaoOrigem: 0, numero: numero(), cc: '9.2' }, comDeps()),
    ).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('ORIGEM BLINDADA: Valor Global ou situação no payload → recusado', async () => {
    const o = await criar({ cc: '9.1' });
    await expect(
      duplicarProposta(await ctx(orcamentista), { origemId: o.id, versaoOrigem: 0, numero: numero(), cc: '9.2', valorGlobal: '1.00' }, comDeps()),
    ).rejects.toBeInstanceOf(ErroDominio);
  });
});

describe('novaVersaoProposta', () => {
  it('V1 em Rascunho gera a V2 em Rascunho; a versão da capa sobe; o Histórico registra; a lista mostra a V2; a exclusão age com a versão nova', async () => {
    const p = await criar({ cc: '9.1' });
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: '0' }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero, versao: 2 } });
    expect(await versoesDe(p.id)).toEqual(['1:RASCUNHO', '2:RASCUNHO']);
    expect(await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: p.id, numero: 2 } })).toMatchObject({ unidadeId: p.unidadeId, criadoPor: orcamentista });
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ versao: 1, excluidaEm: null });

    const historico = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.propostas', registroId: p.id }, orderBy: { id: 'asc' } });
    expect(historico).toHaveLength(2);
    expect(historico[1]).toMatchObject({
      tipoOperacao: 'INSERCAO',
      usuarioId: orcamentista,
      unidadeId: p.unidadeId,
      descricao: `Versão 2 da proposta do TP ${p.numero} criada em Rascunho`,
      depois: { versao: 2, situacao: 'RASCUNHO', versaoAnterior: 1 },
    });

    const minha = (await listarPropostas(await ctx(orcamentista), comDeps())).find((x) => x.id === p.id);
    expect(minha).toMatchObject({ versaoAtual: 2, situacao: 'RASCUNHO', versao: 1 });

    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toEqual(alterado);
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 1 }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero } });
    const [exclusao] = await migrator.historicoOperacao.findMany({ where: { registroId: p.id, tipoOperacao: 'EXCLUSAO' } });
    expect(exclusao!.antes).toMatchObject({ versaoAtual: 2 });
  });

  it('da última Em Elaboração: a V2 nasce em Rascunho e a V1 fica como estava (D-P18-2); a V3 sai da V2', async () => {
    const p = await criar({ cc: '9.1' });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'EM_ELABORACAO' WHERE proposta_id = ${p.id}::uuid`;
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero, versao: 2 } });
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 1 }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero, versao: 3 } });
    expect(await versoesDe(p.id)).toEqual(['1:EM_ELABORACAO', '2:RASCUNHO', '3:RASCUNHO']);
  });

  it('a V2 em Rascunho não abre caminho para excluir a V1 Em Elaboração: a exclusão exige todas em Rascunho (revisão 12.12)', async () => {
    const p = await criar({ cc: '9.1' });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'EM_ELABORACAO' WHERE proposta_id = ${p.id}::uuid`;
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    expect(await excluirProposta(await ctx(orcamentista), { id: p.id, versao: 1 }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: M.PROPOSTA_NAO_EXCLUIVEL }],
    });
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ versao: 1, excluidaEm: null });
    // A lista não oferece a exclusão.
    expect((await listarPropostas(await ctx(orcamentista), comDeps())).find((x) => x.id === p.id)).toMatchObject({ situacao: 'RASCUNHO', excluivel: false });
  });

  it.each(['EM_APROVACAO', 'OFICIALIZADO', 'ENCERRADO'])('última versão %s → VERSAO_NAO_PERMITIDA, nada muda (D-P18-1)', async (situacao) => {
    const p = await criar({ cc: '9.1' });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = ${situacao} WHERE proposta_id = ${p.id}::uuid`;
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: M.VERSAO_NAO_PERMITIDA }],
    });
    expect(await versoesDe(p.id)).toEqual([`1:${situacao}`]);
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ versao: 0 });
    expect(await migrator.historicoOperacao.count({ where: { registroId: p.id } })).toBe(1);
  });

  it('só a última versão conta: V1 Oficializada com a V2 em Rascunho → permitido', async () => {
    const p = await criar({ cc: '9.1' });
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    await migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE proposta_id = ${p.id}::uuid AND numero = 1`;
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 1 }, comDeps())).toEqual({ ok: true, valor: { numero: p.numero, versao: 3 } });
  });

  it('versão diferente → ALTERADO_POR_OUTRO; sem vínculo, excluída ou id inválido → inexistente; nada muda', async () => {
    const p = await criar({ cc: '9.1' });
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 3 }, comDeps())).toEqual(alterado);
    expect(await novaVersaoProposta(await ctx(outro), { id: p.id, versao: 0 }, comDeps())).toEqual(inexistente);
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: 'nao-e-uuid', versao: 0 }, comDeps())).toEqual(inexistente);
    expect(await novaVersaoProposta(await ctx(orcamentista), { id: p.id }, comDeps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: M.PROPOSTA_DADOS_INVALIDOS }] });
    expect(await versoesDe(p.id)).toEqual(['1:RASCUNHO']);
    const antigo = { ...(await ctx(orcamentista)), unidades: [p.unidadeId] };
    expect(await excluirProposta(antigo, { id: p.id, versao: 0 }, comDeps())).toMatchObject({ ok: true });
    expect(await novaVersaoProposta(antigo, { id: p.id, versao: 1 }, comDeps())).toEqual(inexistente);
    expect(await versoesDe(p.id)).toEqual(['1:RASCUNHO']);
  });

  it('sem orc.propostas:incluir → ErroPermissao (D-P18-6)', async () => {
    const p = await criar({ cc: '9.1' });
    await expect(novaVersaoProposta(await ctx(orcamentista, ['orc.propostas:consultar', 'orc.propostas:excluir']), { id: p.id, versao: 0 }, comDeps())).rejects.toBeInstanceOf(
      ErroPermissao,
    );
  });

  it('Histórico indisponível → nenhuma versão nova e a capa sem mudar', async () => {
    const p = await criar({ cc: '9.1' });
    falharAuditoria = true;
    await expect(novaVersaoProposta(await ctx(orcamentista), { id: p.id, versao: 0 }, comDeps())).rejects.toThrow('falha simulada da auditoria');
    expect(await versoesDe(p.id)).toEqual(['1:RASCUNHO']);
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ versao: 0 });
  });

  it('corrida: duas novas versões ao mesmo tempo → uma vence, a outra recebe ALTERADO_POR_OUTRO; não há dois V2', async () => {
    const p = await criar({ cc: '9.1' });
    const contexto = await ctx(orcamentista);
    const resultados = await Promise.all([novaVersaoProposta(contexto, { id: p.id, versao: 0 }, comDeps()), novaVersaoProposta(contexto, { id: p.id, versao: 0 }, comDeps())]);
    expect(resultados.filter((r) => r.ok)).toEqual([{ ok: true, valor: { numero: p.numero, versao: 2 } }]);
    expect(resultados.filter((r) => !r.ok)).toEqual([alterado]);
    expect(await versoesDe(p.id)).toEqual(['1:RASCUNHO', '2:RASCUNHO']);
  });

  // A outra transação, segura aberta de propósito, já subiu a versão da capa: a nova versão passa da
  // leitura, espera a trava da capa e recebe ALTERADO_POR_OUTRO quando a outra termina.
  it.each([
    ['outra nova versão', 'versao'],
    ['uma exclusão', 'exclusao'],
  ] as const)('corrida decidida pela trava da capa: %s grava primeiro → ALTERADO_POR_OUTRO, sem versão órfã', async (_, tipo) => {
    const p = await criar({ cc: '9.1' });
    const contexto = await ctx(orcamentista);
    let pendente!: ReturnType<typeof novaVersaoProposta>;
    await migrator.$transaction(async (tx) => {
      if (tipo === 'versao') {
        await tx.$executeRaw`UPDATE orc_proposta SET versao = versao + 1 WHERE id = ${p.id}::uuid`;
        await tx.$executeRaw`INSERT INTO orc_versao_proposta (unidade_id, proposta_id, numero, criado_por) VALUES (${p.unidadeId}::uuid, ${p.id}::uuid, 2, ${orcamentista}::uuid)`;
      } else {
        await tx.$executeRaw`UPDATE orc_proposta SET versao = versao + 1, excluida_em = now(), excluida_por = criado_por WHERE id = ${p.id}::uuid`;
        await tx.$executeRaw`UPDATE unidade SET ativo = false WHERE id = ${p.unidadeId}::uuid`;
      }
      pendente = novaVersaoProposta(contexto, { id: p.id, versao: 0 }, comDeps());
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(await pendente).toEqual(alterado);
    expect(await versoesDe(p.id)).toEqual(tipo === 'versao' ? ['1:RASCUNHO', '2:RASCUNHO'] : ['1:RASCUNHO']);
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ versao: 1 });
    expect(await migrator.historicoOperacao.count({ where: { registroId: p.id } })).toBe(1);
  });

  it('corrida: a nova versão segura a capa e a exclusão espera → a exclusão recebe ALTERADO_POR_OUTRO e a proposta fica', async () => {
    const p = await criar({ cc: '9.1' });
    const contexto = await ctx(orcamentista);
    let pendente!: ReturnType<typeof excluirProposta>;
    await migrator.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE orc_proposta SET versao = versao + 1 WHERE id = ${p.id}::uuid`;
      await tx.$executeRaw`INSERT INTO orc_versao_proposta (unidade_id, proposta_id, numero, criado_por) VALUES (${p.unidadeId}::uuid, ${p.id}::uuid, 2, ${orcamentista}::uuid)`;
      pendente = excluirProposta(contexto, { id: p.id, versao: 0 }, comDeps());
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(await pendente).toEqual(alterado);
    expect(await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ excluidaEm: null, versao: 1 });
    expect(await migrator.unidade.findUniqueOrThrow({ where: { id: p.unidadeId } })).toMatchObject({ ativo: true });
  });

  it('corrida: exclusão e nova versão ao mesmo tempo, pelos casos de uso → só uma vence', async () => {
    const p = await criar({ cc: '9.1' });
    const contexto = await ctx(orcamentista);
    const [exclusao, versao] = await Promise.all([
      excluirProposta(contexto, { id: p.id, versao: 0 }, comDeps()),
      novaVersaoProposta(contexto, { id: p.id, versao: 0 }, comDeps()),
    ]);
    expect([exclusao.ok, versao.ok].filter(Boolean)).toHaveLength(1);
    if (exclusao.ok) {
      // A nova versão perdeu: pela trava (ALTERADO_POR_OUTRO) ou, se só leu depois do commit da exclusão, inexistente.
      expect([alterado, inexistente]).toContainEqual(versao);
    } else {
      // A exclusão perdeu: sempre pela trava da capa.
      expect(exclusao).toEqual(alterado);
      expect(versao).toEqual({ ok: true, valor: { numero: p.numero, versao: 2 } });
    }
    const capaFinal = await migrator.propostaTp.findUniqueOrThrow({ where: { id: p.id } });
    expect(capaFinal.versao).toBe(1);
    expect(await versoesDe(p.id)).toEqual(exclusao.ok ? ['1:RASCUNHO'] : ['1:RASCUNHO', '2:RASCUNHO']);
    expect(capaFinal.excluidaEm === null).toBe(!exclusao.ok);
  });
});

describe('banco', () => {
  it('CHECK da vigência: término com menos de 30 dias depois do início é recusado também no banco', async () => {
    const p = await criar({ cc: '9.1' });
    await expect(migrator.$executeRaw`UPDATE orc_proposta SET fim = inicio + 29 WHERE id = ${p.id}::uuid`).rejects.toThrow(/orc_proposta_vigencia_check/);
  });

  // RLS com o papel da aplicação (sgo_app) e o app.unidades restrito às unidades do usuário (revisão 12.12).
  const comoApp = async <T>(usuarioId: string, fn: (tx: Parameters<Parameters<typeof app.$transaction>[0]>[0]) => Promise<T>) => {
    const c = await ctx(usuarioId);
    return app.$transaction(async (tx) => {
      await aplicarUnidades(tx, c);
      return fn(tx);
    });
  };

  it('RLS (sgo_app): capa e versão em unidade alheia são recusadas pelo WITH CHECK; a versão com proposta alheia, pelo trigger', async () => {
    const alheia = await criar({ cc: '9.1' }, outro);
    const propria = await criar({ cc: '9.2' });
    // Capa na unidade de outro TP: fora do app.unidades do orçamentista.
    await expect(
      comoApp(orcamentista, (tx) => tx.$executeRaw`INSERT INTO orc_proposta (unidade_id, tipo, objeto, inicio, fim, categoria, criado_por)
        VALUES (${alheia.unidadeId}::uuid, 'CONTRATO', 'x', '2027-01-01', '2027-12-31', 'META', ${orcamentista}::uuid)`),
    ).rejects.toThrow(/row-level security/);
    // Versão na unidade de outro TP: o trigger (BEFORE) roda antes do WITH CHECK e, sob a RLS, não acha a
    // proposta alheia; qualquer das duas defesas recusa.
    await expect(
      comoApp(orcamentista, (tx) => tx.$executeRaw`INSERT INTO orc_versao_proposta (unidade_id, proposta_id, numero, criado_por)
        VALUES (${alheia.unidadeId}::uuid, ${alheia.id}::uuid, 2, ${orcamentista}::uuid)`),
    ).rejects.toThrow(/row-level security|orc\.versao_proposta_outra_unidade/);
    // Versão na própria unidade, mas apontando para a proposta alheia: sob a RLS, o trigger não acha a proposta.
    await expect(
      comoApp(orcamentista, (tx) => tx.$executeRaw`INSERT INTO orc_versao_proposta (unidade_id, proposta_id, numero, criado_por)
        VALUES (${propria.unidadeId}::uuid, ${alheia.id}::uuid, 2, ${orcamentista}::uuid)`),
    ).rejects.toThrow(/orc\.versao_proposta_outra_unidade/);
    // E a leitura da capa alheia volta vazia.
    expect(await comoApp(orcamentista, (tx) => tx.propostaTp.count({ where: { id: alheia.id } }))).toBe(0);
  });

  it('a versão é da mesma unidade da proposta', async () => {
    const [a, b] = [await criar({ cc: '9.1' }), await criar({ cc: '9.2' })];
    await expect(
      migrator.$executeRaw`INSERT INTO orc_versao_proposta (unidade_id, proposta_id, numero, criado_por) VALUES (${b.unidadeId}::uuid, ${a.id}::uuid, 2, ${orcamentista}::uuid)`,
    ).rejects.toThrow(/orc\.versao_proposta_outra_unidade/);
  });
});
