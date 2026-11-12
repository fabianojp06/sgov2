import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { Dinheiro, ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { DepsOrc } from './deps';
import { ccsLivresParaTp, criarProposta, excluirProposta, listarPropostas } from './propostas';

// Proposta de TP: capa, Versão 1 e CC próprio (US-065; plano do P17, Task 1). Como sgo_app (RLS real).
// O falso do C1 ainda não tem a raiz 9 dos TPs (a frente B vai acrescentar): aqui, a árvore do falso
// ganha 9 (sintético), 9.1 e 9.2 (analíticos) e 9.3 (analítico inativo), só neste teste.
let falharAuditoria = false;
vi.mock('@/shared/audit', async (original) => {
  const m = await original<typeof import('@/shared/audit')>();
  return {
    ...m,
    auditar: async (...args: Parameters<typeof m.auditar>) => {
      if (falharAuditoria) throw new Error('falha simulada da auditoria');
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
// A raiz 9 vai em estruturaCompleta (o C1 inteiro) e também em estrutura, enquanto o resolverDeps
// ainda não tem o recorte da Adm. Central à raiz 4.
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, estruturaCompleta: estrutura }) as Partial<DepsOrc>;

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
    const vinculo = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'adm.usuarios', registroId: orcamentista, unidadeId: p.unidadeId } });
    expect(vinculo).toEqual([expect.objectContaining({ tipoOperacao: 'INSERCAO', depois: { unidade: p.numero } })]);
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
      valorGlobal: expect.any(Dinheiro),
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

describe('banco', () => {
  it('CHECK da vigência: término com menos de 30 dias depois do início é recusado também no banco', async () => {
    const p = await criar({ cc: '9.1' });
    await expect(migrator.$executeRaw`UPDATE orc_proposta SET fim = inicio + 29 WHERE id = ${p.id}::uuid`).rejects.toThrow(/orc_proposta_vigencia_check/);
  });

  it('a versão é da mesma unidade da proposta', async () => {
    const [a, b] = [await criar({ cc: '9.1' }), await criar({ cc: '9.2' })];
    await expect(
      migrator.$executeRaw`INSERT INTO orc_versao_proposta (unidade_id, proposta_id, numero, criado_por) VALUES (${b.unidadeId}::uuid, ${a.id}::uuid, 2, ${orcamentista}::uuid)`,
    ).rejects.toThrow(/orc\.versao_proposta_outra_unidade/);
  });
});
