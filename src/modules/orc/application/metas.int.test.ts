import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { DepsOrc } from './deps';
import { alterarMeta, copiarMetasDaVersao, excluirMeta, incluirMeta, listarMetas, metasParaLancamento } from './metas';
import { criarProposta, duplicarProposta, novaVersaoProposta } from './propostas';

// Metas da proposta de TP (US-067; plano do P19, Task 1). Como sgo_app (RLS real). A árvore do falso do C1
// ganha a raiz 9 dos TPs, como no propostas.int.test.ts.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const no = (classificacao: string, descricao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
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
const RAIZ_TPS = no('9', 'Termos de Parceria', false, [no('9.1', 'TP de exemplo 1', true), no('9.2', 'TP de exemplo 2', true)]);
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura });

const TODAS = ['orc.propostas:consultar', 'orc.propostas:incluir', 'orc.propostas:excluir', 'orc.metas:consultar', 'orc.metas:incluir', 'orc.metas:alterar', 'orc.metas:excluir'];
let seq = 0;
let orcamentista: string;
let outro: string;

async function usuario(): Promise<string> {
  const login = `meta${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId = orcamentista, permissoes: string[] = TODAS): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'orcamentista', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}

/** Proposta nova (categoria Meta por padrão), com o id, o número e a versão da capa. */
async function proposta(extra: Record<string, unknown> = {}) {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-12-31', categoria: 'META', cc: '9.1', ...extra },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
const versaoCapa = async (id: string) => (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
const meta = (extra: Record<string, unknown> = {}) => ({ numero: 'M1', nome: 'Meta um', valor: '1.234,56', status: 'ATIVO', observacao: '', ...extra });
/** Os campos do alterar: sem o número, que é blindado. */
const campos = (extra: Record<string, unknown> = {}) => ({ nome: 'Meta um', valor: '1.234,56', status: 'ATIVO', observacao: '', ...extra });
async function incluir(propostaId: string, extra: Record<string, unknown> = {}) {
  const r = await incluirMeta(await ctx(), { propostaId, versaoCapa: await versaoCapa(propostaId), ...meta(extra) }, comDeps());
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return migrator.metaProposta.findFirstOrThrow({ where: { versaoProposta: { propostaId }, numero: String(extra.numero ?? 'M1') }, orderBy: { criadoEm: 'desc' } });
}
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });

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

// Cada teste começa com os CCs de TP livres (9.1 e 9.2).
beforeEach(async () => {
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
});

describe('incluirMeta (UC03.15)', () => {
  it('em Rascunho: grava a meta na última versão, sobe a versão da capa e registra o Histórico', async () => {
    const p = await proposta();
    const r = await incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: 0, ...meta({ observacao: ' Nota ' }) }, comDeps());
    expect(r).toEqual({ ok: true, valor: { numero: 'M1' } });
    const [m, ...resto] = await migrator.metaProposta.findMany({ where: { versaoProposta: { propostaId: p.id } } });
    expect(resto).toEqual([]);
    expect(m).toMatchObject({ numero: 'M1', nome: 'Meta um', status: 'ATIVO', observacao: 'Nota', unidadeId: p.unidadeId, criadoPor: orcamentista, versao: 0 });
    expect(m!.valor.toString()).toBe('1234.56');
    expect(await versaoCapa(p.id)).toBe(1);
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.metas', registroId: m!.id } });
    expect(h).toMatchObject({
      tipoOperacao: 'INSERCAO',
      unidadeId: p.unidadeId,
      descricao: `Meta M1 incluída na versão 1 da proposta do TP ${p.numero}`,
      depois: { numeroTp: p.numero, versaoProposta: 1, numero: 'M1', nome: 'Meta um', valor: '1234.56', status: 'ATIVO', observacao: 'Nota' },
    });
  });

  it('número repetido na versão, também com outra caixa → META_NUMERO_DUPLICADO; noutra proposta, aceito', async () => {
    const p = await proposta();
    await incluir(p.id);
    const r = await incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), ...meta({ numero: 'm1' }) }, comDeps());
    expect(r).toEqual({ ok: false, erros: [{ campo: 'numero', mensagem: M.META_NUMERO_DUPLICADO('m1') }] });
    expect(await versaoCapa(p.id)).toBe(1); // nada gravado: a subida da capa foi desfeita
    const q = await proposta({ cc: '9.2' });
    await expect(incluir(q.id)).resolves.toMatchObject({ numero: 'M1' });
  });

  it('o índice do banco também barra o número repetido sem diferença de caixa', async () => {
    const p = await proposta();
    const m = await incluir(p.id);
    await expect(
      migrator.metaProposta.create({ data: { unidadeId: m.unidadeId, versaoPropostaId: m.versaoPropostaId, numero: 'm1', nome: 'x', valor: '0', criadoPor: orcamentista } }),
    ).rejects.toThrow();
  });

  it('proposta Consolidada → META_SEM_CATEGORIA (D-P19-2); versão Em Aprovação → META_VERSAO_IMUTAVEL (RN0183)', async () => {
    const c = await proposta({ categoria: 'CONSOLIDADA' });
    expect(await incluirMeta(await ctx(), { propostaId: c.id, versaoCapa: 0, ...meta() }, comDeps())).toEqual(erroGeral(M.META_SEM_CATEGORIA));
    const p = await proposta({ cc: '9.2' });
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_APROVACAO' } });
    expect(await incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: 0, ...meta() }, comDeps())).toEqual(erroGeral(M.META_VERSAO_IMUTAVEL));
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_ELABORACAO' } });
    expect(await incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: 0, ...meta() }, comDeps())).toMatchObject({ ok: true });
    expect(await migrator.metaProposta.count({ where: { versaoProposta: { propostaId: c.id } } })).toBe(0);
  });

  it('versão da capa antiga → ALTERADO_POR_OUTRO; proposta sem vínculo ou id inválido → inexistente', async () => {
    const p = await proposta();
    await incluir(p.id);
    expect(await incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: 0, ...meta({ numero: 'M2' }) }, comDeps())).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    expect(await incluirMeta(await ctx(outro), { propostaId: p.id, versaoCapa: 1, ...meta({ numero: 'M2' }) }, comDeps())).toEqual(erroGeral(M.PROPOSTA_INEXISTENTE));
    expect(await incluirMeta(await ctx(), { propostaId: 'x', versaoCapa: 1, ...meta({ numero: 'M2' }) }, comDeps())).toEqual(erroGeral(M.PROPOSTA_INEXISTENTE));
    expect(await migrator.metaProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(1);
  });

  it('validação: campos vazios voltam marcados; ORIGEM BLINDADA: tipo no payload → recusado; sem permissão → ErroPermissao', async () => {
    const p = await proposta();
    const r = await incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: 0, numero: '', nome: '', valor: '', status: '' }, comDeps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]).toEqual({ campo: '_', mensagem: M.META_OBRIGATORIOS });
    await expect(incluirMeta(await ctx(), { propostaId: p.id, versaoCapa: 0, ...meta(), tipo: 'CONTRATO' }, comDeps())).rejects.toBeInstanceOf(ErroDominio);
    await expect(incluirMeta(await ctx(orcamentista, ['orc.metas:consultar']), { propostaId: p.id, versaoCapa: 0, ...meta() }, comDeps())).rejects.toBeInstanceOf(ErroPermissao);
    expect(await migrator.metaProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(0);
  });

  it('corrida: duas inclusões com a mesma versão da capa → uma grava, a outra recebe ALTERADO_POR_OUTRO', async () => {
    const p = await proposta();
    const c = await ctx();
    const resultados = await Promise.all([
      incluirMeta(c, { propostaId: p.id, versaoCapa: 0, ...meta({ numero: 'M1' }) }, comDeps()),
      incluirMeta(c, { propostaId: p.id, versaoCapa: 0, ...meta({ numero: 'M2' }) }, comDeps()),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    expect(await migrator.metaProposta.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(1);
  });
});

describe('alterarMeta (UC03.16)', () => {
  it('muda nome, valor, status e observação; sobe as versões; o Histórico guarda antes e depois', async () => {
    const p = await proposta();
    const m = await incluir(p.id);
    const r = await alterarMeta(await ctx(), { id: m.id, versao: 0, versaoCapa: 1, nome: 'Meta nova', valor: '10,00', status: 'INATIVO', observacao: 'x' }, comDeps());
    expect(r).toEqual({ ok: true, valor: { numero: 'M1' } });
    const depois = await migrator.metaProposta.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois).toMatchObject({ numero: 'M1', nome: 'Meta nova', status: 'INATIVO', observacao: 'x', versao: 1 });
    expect(depois.valor.toString()).toBe('10');
    expect(await versaoCapa(p.id)).toBe(2);
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.metas', registroId: m.id, tipoOperacao: 'ALTERACAO' } });
    expect(h).toMatchObject({
      antes: { numero: 'M1', nome: 'Meta um', valor: '1234.56', status: 'ATIVO', observacao: null },
      depois: { numero: 'M1', nome: 'Meta nova', valor: '10.00', status: 'INATIVO', observacao: 'x' },
    });
  });

  it('o número é blindado (UC03.16, passo 4); versão da meta antiga → ALTERADO_POR_OUTRO, sem mudar nada', async () => {
    const p = await proposta();
    const m = await incluir(p.id);
    await expect(alterarMeta(await ctx(), { id: m.id, versao: 0, versaoCapa: 1, ...meta({ numero: 'M9' }) }, comDeps())).rejects.toBeInstanceOf(ErroDominio);
    const semNumero = campos({ nome: 'Outro' });
    expect(await alterarMeta(await ctx(), { id: m.id, versao: 5, versaoCapa: 1, ...semNumero }, comDeps())).toEqual(erroGeral(M.ALTERADO_POR_OUTRO));
    expect(await versaoCapa(p.id)).toBe(1);
    expect(await migrator.metaProposta.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ nome: 'Meta um', versao: 0 });
  });

  it('meta de versão anterior → META_VERSAO_IMUTAVEL; de quem não vê ou id inválido → META_INEXISTENTE', async () => {
    const p = await proposta();
    const m = await incluir(p.id);
    expect(await novaVersaoProposta(await ctx(), { id: p.id, versao: 1 }, comDeps())).toMatchObject({ ok: true });
    const semNumero = campos({ nome: 'Outro' });
    expect(await alterarMeta(await ctx(), { id: m.id, versao: 0, versaoCapa: 2, ...semNumero }, comDeps())).toEqual(erroGeral(M.META_VERSAO_IMUTAVEL));
    expect(await alterarMeta(await ctx(outro), { id: m.id, versao: 0, versaoCapa: 2, ...semNumero }, comDeps())).toEqual(erroGeral(M.META_INEXISTENTE));
    expect(await alterarMeta(await ctx(), { id: 'x', versao: 0, versaoCapa: 2, ...semNumero }, comDeps())).toEqual(erroGeral(M.META_INEXISTENTE));
  });
});

describe('excluirMeta (UC03.17)', () => {
  it('apaga a meta, sobe a capa e o Histórico guarda o antes; versão Em Aprovação → META_VERSAO_IMUTAVEL', async () => {
    const p = await proposta();
    const m = await incluir(p.id);
    expect(await excluirMeta(await ctx(), { id: m.id, versao: 0, versaoCapa: 1 }, comDeps())).toEqual({ ok: true, valor: { numero: 'M1' } });
    expect(await migrator.metaProposta.count({ where: { id: m.id } })).toBe(0);
    expect(await versaoCapa(p.id)).toBe(2);
    const [h] = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.metas', registroId: m.id, tipoOperacao: 'EXCLUSAO' } });
    expect(h).toMatchObject({ antes: { numero: 'M1', valor: '1234.56' }, descricao: `Meta M1 excluída da versão 1 da proposta do TP ${p.numero}` });

    const m2 = await incluir(p.id, { numero: 'M2' });
    await migrator.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'EM_APROVACAO' } });
    expect(await excluirMeta(await ctx(), { id: m2.id, versao: 0, versaoCapa: 3 }, comDeps())).toEqual(erroGeral(M.META_VERSAO_IMUTAVEL));
    expect(await migrator.metaProposta.count({ where: { id: m2.id } })).toBe(1);
  });

  it('sem orc.metas:excluir → ErroPermissao', async () => {
    const p = await proposta();
    const m = await incluir(p.id);
    await expect(excluirMeta(await ctx(orcamentista, ['orc.metas:consultar']), { id: m.id, versao: 0, versaoCapa: 1 }, comDeps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('cópia das metas (RN_DUP_003)', () => {
  it('nova versão e duplicação copiam as metas com ids novos; mexer na cópia não muda a origem', async () => {
    const p = await proposta();
    const m1 = await incluir(p.id);
    await incluir(p.id, { numero: 'M2', status: 'INATIVO' });
    expect(await novaVersaoProposta(await ctx(), { id: p.id, versao: 2 }, comDeps())).toMatchObject({ ok: true });
    const v2 = await migrator.metaProposta.findMany({ where: { versaoProposta: { propostaId: p.id, numero: 2 } }, orderBy: { numero: 'asc' } });
    expect(v2.map((m) => [m.numero, m.status, m.valor.toString()])).toEqual([
      ['M1', 'ATIVO', '1234.56'],
      ['M2', 'INATIVO', '1234.56'],
    ]);
    expect(v2.map((m) => m.id)).not.toContain(m1.id);

    const copia = v2.find((m) => m.numero === 'M1')!;
    expect(await alterarMeta(await ctx(), { id: copia.id, versao: 0, versaoCapa: 3, nome: 'Na V2', valor: '1,00', status: 'ATIVO' }, comDeps())).toMatchObject({ ok: true });
    expect(await migrator.metaProposta.findUniqueOrThrow({ where: { id: m1.id } })).toMatchObject({ nome: 'Meta um' });

    const d = await duplicarProposta(await ctx(), { origemId: p.id, versaoOrigem: 4, numero: `TP-D${++seq}`, cc: '9.2' }, comDeps());
    if (!d.ok) throw new Error(JSON.stringify(d.erros));
    const nova = await migrator.metaProposta.findMany({ where: { versaoProposta: { propostaId: d.valor.id } }, orderBy: { numero: 'asc' } });
    expect(nova.map((m) => [m.numero, m.nome, m.unidadeId])).toEqual([
      ['M1', 'Na V2', d.valor.unidadeId],
      ['M2', 'Meta um', d.valor.unidadeId],
    ]);
  });

  it('versão sem metas: nada a copiar', async () => {
    const p = await proposta();
    const [v1] = await migrator.versaoProposta.findMany({ where: { propostaId: p.id } });
    await migrator.$transaction((tx) => copiarMetasDaVersao(tx, v1!.id, v1!.id, orcamentista));
    expect(await migrator.metaProposta.count({ where: { versaoPropostaId: v1!.id } })).toBe(0);
  });
});

describe('listarMetas (UC03.14) e metasParaLancamento (RN_VIA_04)', () => {
  it('blocos por proposta com a última versão; total só das ativas e saldo; filtros por tipo, proposta e meta; RLS', async () => {
    const p = await proposta({ objeto: 'Programa de capacitação' });
    await incluir(p.id, { numero: 'M2', nome: 'Oficinas', valor: '100,00' });
    await incluir(p.id, { numero: 'M10', nome: 'Cursos', valor: '50,50' });
    await incluir(p.id, { numero: 'M3', nome: 'Parada', valor: '999,00', status: 'INATIVO' });
    const c = await proposta({ categoria: 'CONSOLIDADA', tipo: 'CONTRATO', cc: '9.2' });

    const blocos = await listarMetas(await ctx(), {}, comDeps());
    expect(blocos.map((b) => [b.numero, b.categoria, b.editavel])).toEqual([
      [p.numero, 'META', true],
      [c.numero, 'CONSOLIDADA', false],
    ]);
    const b = blocos[0]!;
    expect(b.metas.map((m) => m.numero)).toEqual(['M2', 'M3', 'M10']);
    expect(b.totalMetas.paraString()).toBe('150.50');
    expect(b.saldo.paraString()).toBe('-150.50');
    expect(b).toMatchObject({ versaoNumero: 1, situacao: 'RASCUNHO', versaoCapa: 3 });

    expect((await listarMetas(await ctx(), { tipo: 'CONTRATO' }, comDeps())).map((x) => x.numero)).toEqual([c.numero]);
    expect((await listarMetas(await ctx(), { proposta: 'capacita' }, comDeps())).map((x) => x.numero)).toEqual([p.numero]);
    const porMeta = await listarMetas(await ctx(), { meta: 'ofic' }, comDeps());
    expect(porMeta.map((x) => [x.numero, x.metas.map((m) => m.numero)])).toEqual([[p.numero, ['M2']]]);
    expect(porMeta[0]!.totalMetas.paraString()).toBe('150.50');
    expect(await listarMetas(await ctx(outro), {}, comDeps())).toEqual([]);
    await expect(listarMetas(await ctx(orcamentista, []), {}, comDeps())).rejects.toBeInstanceOf(ErroPermissao);

    const [v1] = await migrator.versaoProposta.findMany({ where: { propostaId: p.id } });
    const lista = await migrator.$transaction((tx) => metasParaLancamento(tx, v1!.id));
    expect(lista.map((m) => m.numero)).toEqual(['M2', 'M10']);
  });
});
