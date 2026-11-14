import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, CONTAS_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto, type NoConta } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { obterConsolidado } from './consolidado';
import type { DepsOrc } from './deps';
import { montarArquivoRealizado } from './planilhas-teste';
import { criarProposta } from './propostas';
import { carregarRealizado, fecharCompetencia, obterTelaRealizado, realizadoPorTp } from './realizado';

// Realizado por arquivo (US-085, parte 1; plano do P32, Task 2; OxR V2, AC06 e AC07). Como sgo_app (RLS real), com o
// arquivo .xlsx de verdade pelo leitor do ger. A competência fechada é global: cada teste usa os seus meses.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `91.${classificacao}`,
  descricao: `CC ${classificacao}`,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: analitico ? 'ANALITICO' : 'SINTETICO',
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: true,
  filhos,
});
// Uma analítica inativa (soft delete, RN_OXR_001) ao lado das contas de exemplo.
const INATIVA: NoConta = { classificacao: '4.1.1.5.009', codigoReduzido: '1290', descricao: 'Conta antiga', nivel: 5, tipo: 'ANALITICA', ativa: false, filhos: [] };
const comInativa = (nos: readonly NoConta[]): NoConta[] =>
  nos.map((n) => ({ ...n, filhos: n.classificacao === '4.1.1.5' ? [...comInativa(n.filhos), INATIVA] : comInativa(n.filhos) }));
const estrutura = estruturaFinanceiraFalsa({ contas: comInativa(CONTAS_EXEMPLO), centrosCusto: [...CENTROS_CUSTO_EXEMPLO, cc('9', false, [cc('9.1', true), cc('9.2', true)])] });
const AGORA = new Date('2026-11-14T12:00:00Z');
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, agora: () => AGORA });

let orcamentista: string;
let gfin: string;
const tps: Record<'a' | 'b', { id: string; unidadeId: string }> = {} as never;

async function usuario(login: string): Promise<string> {
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const REALIZADO = ['orc.realizado:consultar', 'orc.realizado:executar', 'orc.realizado:aprovar'];
const ctx = (usuarioId: string, unidades: string[], permissoes = REALIZADO): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'u',
  sessaoUid: 's1',
  ip: null,
  permissoes: new Set(permissoes),
  unidades,
  unidadeId: null,
});
const gfinA = () => ctx(gfin, [tps.a.unidadeId]);
const carregar = async (linhas: (string | number | null)[][], c = gfinA(), propostaId = tps.a.id) =>
  carregarRealizado(c, { propostaId, arquivo: await montarArquivoRealizado(linhas) }, comDeps());
const exigirOk = <T,>(r: { ok: true; valor: T } | { ok: false; erros: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
};
const doMes = async (competencia: string) =>
  (await migrator.realizadoContaMes.findMany({ where: { unidadeId: tps.a.unidadeId, competencia: new Date(`${competencia}-01`) }, orderBy: { conta: 'asc' } })).map((r) => [
    r.conta,
    r.valor.toString(),
  ]);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario('real.orc');
  gfin = await usuario('real.gfin');
  for (const [k, numero, c] of [['a', 'TP-R01/2026', '9.1'], ['b', 'TP-R02/2026', '9.2']] as const) {
    const r = await criarProposta(
      ctx(orcamentista, [], ['orc.propostas:consultar', 'orc.propostas:incluir']),
      { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2026-01-01', fim: '2026-12-31', categoria: 'CONSOLIDADA', cc: c },
      comDeps(),
    );
    tps[k] = exigirOk(r);
  }
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('carregarRealizado (US-085)', () => {
  it('mês aberto: grava; a recarga substitui a competência inteira e deixa as outras como estão (RN_OXR_005, D-P32-3)', async () => {
    const r = exigirOk(await carregar([['4.1.1.1.001', '2026-01', 1000], ['4.1.1.5.005', '01/2026', 250.5], ['4.1.1.5.005', '2026-01', 49.5], ['4.1.1.1.001', '2026-02', 700]]));
    expect([r.linhas, r.total.paraString(), r.substituidas, r.fechadas, r.ajustes, r.pendencias.quantidade]).toEqual([3, '2000.00', ['2026-01', '2026-02'], [], 0, 0]);
    expect(await doMes('2026-01')).toEqual([['4.1.1.1.001', '1000'], ['4.1.1.5.005', '300']]);
    exigirOk(await carregar([['4.1.1.1.001', '2026-01', 1100]]));
    expect(await doMes('2026-01')).toEqual([['4.1.1.1.001', '1100']]);
    expect(await doMes('2026-02')).toEqual([['4.1.1.1.001', '700']]);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.realizado', tipoOperacao: 'INSERCAO' } })).toBeGreaterThanOrEqual(2);
  });

  it('AC06: conta desconhecida e conta sintética viram pendência, sem mudar outra conta; a recarga as substitui (RN_OXR_004, D-P32-6)', async () => {
    const r = exigirOk(await carregar([['9.9.9.9.999', '2026-03', 80], ['4.1.1.1', '2026-03', 20], ['4.1.1.1.003', '2026-03', 5]]));
    expect([r.pendencias.quantidade, r.pendencias.valor.paraString()]).toEqual([2, '100.00']);
    expect(await doMes('2026-03')).toEqual([['4.1.1.1.003', '5']]);
    const p = await migrator.pendenciaRealizado.findMany({ where: { unidadeId: tps.a.unidadeId }, orderBy: { contaErp: 'asc' } });
    expect(p.map((x) => [x.contaErp, x.motivo, x.valor.toString()])).toEqual([['4.1.1.1', 'CONTA_SINTETICA', '20'], ['9.9.9.9.999', 'CONTA_DESCONHECIDA', '80']]);
    exigirOk(await carregar([['9.9.9.9.999', '2026-03', 10]]));
    expect((await migrator.pendenciaRealizado.findMany({ where: { unidadeId: tps.a.unidadeId } })).map((x) => x.valor.toString())).toEqual(['10']);
  });

  it('conta analítica inativa (soft delete) recebe realizado, sem pendência (RN_OXR_001)', async () => {
    const r = exigirOk(await carregar([['4.1.1.5.009', '2026-04', 33]]));
    expect(r.pendencias.quantidade).toBe(0);
    expect(await doMes('2026-04')).toEqual([['4.1.1.5.009', '33']]);
  });

  it('AC07: Mai fechado e o arquivo traz +2.000,00: Mai não muda; Jun recebe o ajuste com origem Mai; a recarga igual não gera ajuste novo (RN_OXR_006, D-P32-5)', async () => {
    exigirOk(await carregar([['4.1.1.1.001', '2026-05', 10000], ['4.1.1.5.005', '2026-05', 300]]));
    exigirOk(await fecharCompetencia(gfinA(), { competencia: '2026-05' }, comDeps()));
    const r = exigirOk(await carregar([['4.1.1.1.001', '2026-05', 12000], ['4.1.1.1.001', '2026-06', 500]]));
    expect([r.substituidas, r.fechadas, r.ajustes]).toEqual([['2026-06'], ['2026-05'], 2]);
    expect(await doMes('2026-05')).toEqual([['4.1.1.1.001', '10000'], ['4.1.1.5.005', '300']]);
    const ajustes = await migrator.ajusteRealizado.findMany({ where: { unidadeId: tps.a.unidadeId }, orderBy: { conta: 'asc' } });
    expect(ajustes.map((a) => [a.conta, a.competenciaOrigem.toISOString().slice(0, 7), a.competenciaLancamento.toISOString().slice(0, 7), a.valor.toString()])).toEqual([
      ['4.1.1.1.001', '2026-05', '2026-06', '2000'],
      ['4.1.1.5.005', '2026-05', '2026-06', '-300'], // a conta que o arquivo deixou de trazer vale zero
    ]);
    const outra = exigirOk(await carregar([['4.1.1.1.001', '2026-05', 12000], ['4.1.1.1.001', '2026-06', 500]]));
    expect(outra.ajustes).toBe(0);
    // RN_OXR_008: o realizado de Jun = carga + ajustes lançados em Jun.
    const porta = await realizadoPorTp(gfinA(), { tp: 'TP-R01/2026', de: '2026-05', ate: '2026-06' }, comDeps());
    expect(porta?.linhas.map((l) => [l.conta, l.competencia, l.valor.paraString()])).toEqual([
      ['4.1.1.1.001', '2026-05', '10000.00'],
      ['4.1.1.5.005', '2026-05', '300.00'],
      ['4.1.1.1.001', '2026-06', '2500.00'],
      ['4.1.1.5.005', '2026-06', '-300.00'],
    ]);
    expect(porta?.ajustes.map((a) => [a.origem, a.lancamento])).toEqual([['2026-05', '2026-06'], ['2026-05', '2026-06']]);
    expect(porta?.atualizadoEm).toBeInstanceOf(Date);
  });

  it('erro em qualquer linha: nada é gravado, e a recusa vai ao Histórico (D-P32-2, RN_OXR_007)', async () => {
    const [cargas, recusas] = await Promise.all([
      migrator.cargaRealizado.count(),
      migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.realizado', tipoOperacao: 'SISTEMA' } }),
    ]);
    const r = await carregar([['4.1.1.1.001', '2026-07', 1], ['4.1.1.1.001', '2027-01', 1], ['4.1.1.1.001', '2026-07', '1,5']]);
    expect(!r.ok && r.erros.map((e) => e.campo)).toEqual(['_', 'linhas.3.Competência', 'linhas.4.Valor']);
    expect(await migrator.cargaRealizado.count()).toBe(cargas);
    expect(await doMes('2026-07')).toEqual([]);
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.realizado', tipoOperacao: 'SISTEMA' } })).toBe(recusas + 1);
  });

  it('RLS: quem só opera o outro TP não lê nem carrega o realizado deste', async () => {
    const deB = ctx(gfin, [tps.b.unidadeId]);
    expect(await obterTelaRealizado(deB, tps.a.id, comDeps())).toBeNull();
    expect(await realizadoPorTp(deB, { tp: 'TP-R01/2026', de: '2026-01', ate: '2026-12' }, comDeps())).toBeNull();
    const r = await carregar([['4.1.1.1.001', '2026-08', 1]], deB);
    expect(!r.ok && r.erros[0]!.mensagem).toBe('Termo de Parceria não encontrado nos seus Termos de Parceria.');
    expect(await emUnidadeContar(deB)).toBe(0);
  });

  it('sem a permissão: carregar, fechar e ler são negados', async () => {
    const so = ctx(gfin, [tps.a.unidadeId], ['orc.realizado:consultar']);
    await expect(carregar([['4.1.1.1.001', '2026-08', 1]], so)).rejects.toThrow();
    await expect(fecharCompetencia(so, { competencia: '2026-08' }, comDeps())).rejects.toThrow();
    await expect(realizadoPorTp(ctx(gfin, [tps.a.unidadeId], []), { tp: 'TP-R01/2026', de: '2026-01', ate: '2026-12' }, comDeps())).rejects.toThrow();
  });
});

async function emUnidadeContar(c: ContextoRequisicao) {
  const { emUnidade } = await import('@/shared/unidade');
  return emUnidade(c, (tx) => tx.realizadoContaMes.count(), { cliente: app });
}

describe('fecharCompetencia (D-P32-4)', () => {
  it('só competência anterior ao mês corrente, uma vez só; vai ao Histórico', async () => {
    const r1 = await fecharCompetencia(gfinA(), { competencia: '2026-11' }, comDeps());
    expect(!r1.ok && r1.erros[0]!.mensagem).toBe('Só é possível fechar competência anterior ao mês corrente.');
    exigirOk(await fecharCompetencia(gfinA(), { competencia: '2026-09' }, comDeps()));
    const r2 = await fecharCompetencia(gfinA(), { competencia: '2026-09' }, comDeps());
    expect(!r2.ok && r2.erros[0]!.mensagem).toBe('Esta competência já está fechada.');
    const r3 = await fecharCompetencia(gfinA(), { competencia: '2026-9' }, comDeps());
    expect(!r3.ok && r3.erros[0]!.mensagem).toBe('Competência inválida. Use AAAA-MM.');
    expect(await migrator.historicoOperacao.count({ where: { funcionalidade: 'orc.realizado', registroId: '2026-09' } })).toBe(1);
  });

  it('a tela mostra a competência fechada e o total do TP', async () => {
    const t = await obterTelaRealizado(gfinA(), tps.a.id, comDeps());
    expect(t?.competencias.find((c) => c.competencia === '2026-05')?.fechada).toBe(true);
    expect(t?.competencias.find((c) => c.competencia === '2026-01')?.fechada).toBe(false);
    expect(t?.competencias).toHaveLength(12);
    expect(t?.cargas.length).toBeGreaterThan(0);
  });
});

describe('Consolidado com o realizado (D-P32-8)', () => {
  it('o realizado do TP é a soma de carga e ajustes; o outro TP fica em zero', async () => {
    const c = await obterConsolidado(ctx(gfin, [], ['orc.consolidado:consultar']), comDeps());
    const t = await obterTelaRealizado(gfinA(), tps.a.id, comDeps());
    const linhas = new Map(c.linhas.map((l) => [l.numero, l.realizado.paraString()]));
    expect(linhas.get('TP-R01/2026')).toBe(t!.total.paraString());
    expect(linhas.get('TP-R02/2026')).toBe('0.00');
  });
});
