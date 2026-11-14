import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MENSAGENS_ALCADA } from '@/modules/adm/servidor';
import { decidirSolicitacao } from '@/modules/apr';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { campoCelula, campoConta } from '../domain/rateio';
import { incluirBem } from './bens';
import { incluirEmpregado } from './empregados';
import type { DepsOrc } from './deps';
import { incluirMeta } from './metas';
import { avancarProposta, enviarPropostaWa01, manipuladorWa01 } from './oficializacao';
import { criarProposta } from './propostas';
import { salvarRateio } from './rateio';
import { incluirTeto, incluirViagem } from './viagens';

// Oficialização da proposta de TP (US-079; plano do P26, Task 2). Como sgo_app (RLS real). A alçada WA01 tem o GFIN
// de titular e a DIREX de substituta; o C1 é o falso do cad (CONTAS_EXEMPLO), com o bem em 4.1.1.5.005.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;

const cc = (classificacao: string, descricao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
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
const RAIZ_TPS = cc('9', 'Termos de Parceria', false, [cc('9.1', 'TP de exemplo 1', true)]);
const estrutura = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, RAIZ_TPS] });
const [C001] = cargosExemplo().map((c) => c.id) as [string];
const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargosExemplo()), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio });

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const ORCAMENTISTA = [
  'orc.propostas:consultar',
  'orc.propostas:incluir',
  ...LANCA.flatMap((a) => [`orc.metas:${a}`, `orc.bens:${a}`, `orc.rateio:${a}`, `orc.empregados:${a}`, `orc.viagens:${a}`]),
];
const APROVADOR = ['apr.tarefas:consultar', 'apr.tarefas:executar'];
let seq = 0;
let orcamentista: string;
let gfin: string;
let direx: string;

async function usuario(): Promise<string> {
  const login = `ofi${++seq}`;
  return (await migrator.usuario.create({ data: { nome: `Pessoa ${login}`, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId = orcamentista, permissoes: string[] = ORCAMENTISTA): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}
const versaoCapa = async (id: string) => (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
const situacao = async (propostaId: string) => (await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId }, orderBy: { numero: 'desc' } })).situacao;
const exigirOk = (r: { ok: boolean; erros?: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
};
async function proposta(extra: Record<string, unknown> = {}) {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-03-31', categoria: 'CONSOLIDADA', cc: '9.1', ...extra },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  exigirOk(
    await incluirBem(
      await ctx(),
      {
        propostaId: r.valor.id,
        versaoCapa: await versaoCapa(r.valor.id),
        conta: '4.1.1.5.005',
        descricao: 'Notebook',
        data: '2027-02-10',
        quantidade: '2',
        valorUnitario: '1.000,00',
      },
      comDeps(),
    ),
  );
  return r.valor;
}
const avancar = async (id: string) => avancarProposta(await ctx(), { id, versao: await versaoCapa(id) }, comDeps());
const enviar = async (id: string, quem = orcamentista) => enviarPropostaWa01(await ctx(quem), { id, versao: await versaoCapa(id) }, comDeps());
const pendente = async (numero: string) => migrator.solicitacaoAprovacao.findFirstOrThrow({ where: { descricao: { startsWith: `TP ${numero} ` }, situacao: 'EM_APROVACAO' } });
const decidir = async (s: { id: string; versao: number }, decisao: 'APROVAR' | 'REJEITAR', quem = gfin, justificativa?: string) =>
  decidirSolicitacao(
    await ctx(quem, APROVADOR),
    { id: s.id, versao: s.versao, decisao, ...(justificativa ? { justificativa } : {}) },
    { WA01: manipuladorWa01(comDeps()) },
    { cliente: app },
  );
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  orcamentista = await usuario();
  gfin = await usuario();
  direx = await usuario();
  await migrator.alcadaAprovacao.create({ data: { fluxo: 'WA01', titularId: gfin, substitutoId: direx, criadaEm: new Date() } });
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
  await migrator.usuario.updateMany({ where: { id: { in: [gfin, direx] } }, data: { ativo: true } });
});

describe('avançar e enviar (UC03.10 e UC6.00 passos 1 a 3)', () => {
  it('Rascunho não envia (E4); avança uma vez; envia roteando ao titular, que é vinculado à unidade', async () => {
    const p = await proposta();
    expect(await enviar(p.id)).toEqual(erroGeral(M.ENVIO_STATUS_INVALIDO));
    expect(await avancar(p.id)).toEqual({ ok: true, valor: { numero: p.numero } });
    expect(await situacao(p.id)).toBe('EM_ELABORACAO');
    expect(await avancar(p.id)).toEqual(erroGeral(M.AVANCO_SO_RASCUNHO));
    expect(await enviar(p.id)).toEqual({ ok: true, valor: { numero: p.numero } });
    expect(await situacao(p.id)).toBe('EM_APROVACAO');
    const s = await pendente(p.numero);
    expect(s).toMatchObject({ fluxo: 'WA01', aprovadorId: gfin, papelAprovador: 'TITULAR', solicitanteId: orcamentista, unidadeId: p.unidadeId });
    expect(await migrator.usuarioUnidade.count({ where: { usuarioId: gfin, unidadeId: p.unidadeId } })).toBe(1);
    expect(await enviar(p.id)).toMatchObject({ ok: false });
  });

  it('Em Aprovação, todas as abas ficam só leitura (Review Focus 5)', async () => {
    const p = await proposta();
    await avancar(p.id);
    exigirOk(await enviar(p.id));
    const base = async () => ({ propostaId: p.id, versaoCapa: await versaoCapa(p.id) });
    expect(
      await incluirBem(await ctx(), { ...(await base()), conta: '4.1.1.5.005', descricao: 'Outro', data: '2027-02-10', quantidade: '1', valorUnitario: '1,00' }, comDeps()),
    ).toEqual(erroGeral(M.BEM_VERSAO_IMUTAVEL));
    expect(
      await incluirEmpregado(await ctx(), { ...(await base()), categoria: 'EMPREGADO', nome: '', cargoId: C001, inicio: '2027-01', fim: '2027-03', dependentes: '0' }, comDeps()),
    ).toEqual(erroGeral(M.EMPREGADO_VERSAO_IMUTAVEL));
    expect(await incluirTeto(await ctx(), { ...(await base()), contaSintetica: '4.1.1.5', valor: '1.000,00' }, comDeps())).toEqual(erroGeral(M.VIAGEM_VERSAO_IMUTAVEL));
    expect(
      await incluirViagem(
        await ctx(),
        { ...(await base()), localidade: 'X', pessoas: '1', dias: '1', valorPassagem: '1', valorDiaria: '1', contaPassagem: '4.1.1.5.005', contaDiaria: '4.1.1.5.005' },
        comDeps(),
      ),
    ).toEqual(erroGeral(M.VIAGEM_VERSAO_IMUTAVEL));
    expect(await salvarRateio(await ctx(), { propostaId: p.id, versaoCapa: String(await versaoCapa(p.id)), contaSintetica: '4.1.1.5', modo: 'VALOR' }, comDeps())).toEqual(
      erroGeral(M.RATEIO_VERSAO_IMUTAVEL),
    );
    // Na categoria Meta, a meta também (a Consolidada recusaria antes, pela categoria). O CC 9.1 fica livre antes.
    await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE id = ${p.unidadeId}::uuid`;
    const pm = await criarProposta(
      await ctx(),
      { tipo: 'TERMO_PARCERIA', numero: `TP-M${++seq}`, objeto: 'Meta', parceiro: '', inicio: '2027-01-01', fim: '2027-03-31', categoria: 'META', cc: '9.1' },
      comDeps(),
    );
    if (!pm.ok) throw new Error(JSON.stringify(pm.erros));
    await avancar(pm.valor.id);
    exigirOk(await enviar(pm.valor.id));
    expect(
      await incluirMeta(await ctx(), { propostaId: pm.valor.id, versaoCapa: await versaoCapa(pm.valor.id), numero: 'M1', nome: 'Meta', valor: '0', status: 'ATIVO' }, comDeps()),
    ).toEqual(erroGeral(M.META_VERSAO_IMUTAVEL));
  });

  it('o custo do pessoal incompleto (ano sem parâmetros) bloqueia o envio: o snapshot seria parcial (revisão 12.12)', async () => {
    const p = await proposta({ fim: '2028-06-30' });
    exigirOk(
      await incluirEmpregado(
        await ctx(),
        { propostaId: p.id, versaoCapa: await versaoCapa(p.id), categoria: 'EMPREGADO', nome: 'Ana', cargoId: C001, inicio: '2027-01', fim: '2028-03', dependentes: '0' },
        comDeps(),
      ),
    );
    await avancar(p.id);
    expect(await enviar(p.id)).toEqual(erroGeral(M.ENVIO_PESSOAL_INCOMPLETO(M.EMPREGADO_SEM_PARAMETROS(2028))));
  });

  it('rateio com competências em branco (RN_WA01_002) e titular inativo (substituto, RN_ALC_005)', async () => {
    const p = await proposta();
    await avancar(p.id);
    exigirOk(
      await salvarRateio(
        await ctx(),
        {
          propostaId: p.id,
          versaoCapa: String(await versaoCapa(p.id)),
          contaSintetica: '4.1.1.5',
          modo: 'VALOR',
          [campoConta(0)]: '4.1.1.2.001',
          [campoCelula(0, '2027-01')]: '10,00',
          [campoCelula(0, '2027-03')]: '0',
        },
        comDeps(),
      ),
    );
    expect(await enviar(p.id)).toEqual({
      ok: false,
      erros: [
        { campo: '_', mensagem: M.ENVIO_CELULAS_EM_BRANCO },
        { campo: '_', mensagem: M.ENVIO_CELULAS_EM_BRANCO_DETALHE('4.1.1.2.001', '02/2027') },
      ],
    });
    exigirOk(
      await salvarRateio(
        await ctx(),
        {
          propostaId: p.id,
          versaoCapa: String(await versaoCapa(p.id)),
          contaSintetica: '4.1.1.5',
          modo: 'VALOR',
          [campoConta(0)]: '4.1.1.2.001',
          [campoCelula(0, '2027-01')]: '10,00',
          [campoCelula(0, '2027-02')]: '0',
          [campoCelula(0, '2027-03')]: '0',
        },
        comDeps(),
      ),
    );
    await migrator.usuario.update({ where: { id: gfin }, data: { ativo: false } });
    exigirOk(await enviar(p.id));
    expect(await pendente(p.numero)).toMatchObject({ aprovadorId: direx, papelAprovador: 'SUBSTITUTO' });
  });

  it('sem aprovador disponível (E5) e quem envia é o único aprovador (RN_WA02_006)', async () => {
    const p = await proposta();
    await avancar(p.id);
    await migrator.usuario.updateMany({ where: { id: { in: [gfin, direx] } }, data: { ativo: false } });
    expect(await enviar(p.id)).toEqual(erroGeral(MENSAGENS_ALCADA.SEM_APROVADOR('WA01')));
    await migrator.usuario.updateMany({ where: { id: gfin }, data: { ativo: true } });
    await migrator.usuarioUnidade.create({ data: { usuarioId: gfin, unidadeId: p.unidadeId } });
    expect(await enviarPropostaWa01(await ctx(gfin, ORCAMENTISTA), { id: p.id, versao: await versaoCapa(p.id) }, comDeps())).toEqual(
      erroGeral(MENSAGENS_ALCADA.MESMO_USUARIO('WA01')),
    );
  });

  it('dois envios ao mesmo tempo: um só fica (Review Focus 1)', async () => {
    const p = await proposta();
    await avancar(p.id);
    const versao = await versaoCapa(p.id);
    const [a, b] = await Promise.all([enviarPropostaWa01(await ctx(), { id: p.id, versao }, comDeps()), enviarPropostaWa01(await ctx(), { id: p.id, versao }, comDeps())]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect(await migrator.solicitacaoAprovacao.count({ where: { descricao: { startsWith: `TP ${p.numero} ` } } })).toBe(1);
  });
});

describe('decisão do WA01 na Central de Tarefas (UC6.00 passo 5 e FA-A)', () => {
  it('rejeitar devolve para Em Elaboração; reenviar e aprovar oficializa com o snapshot', async () => {
    const p = await proposta();
    await avancar(p.id);
    exigirOk(await enviar(p.id));
    const s1 = await pendente(p.numero);
    expect(await decidir(s1, 'REJEITAR', gfin, 'Falta declarar o rateio de março.')).toMatchObject({ ok: true });
    expect(await situacao(p.id)).toBe('EM_ELABORACAO');
    exigirOk(await enviar(p.id));
    const s2 = await pendente(p.numero);
    expect(await decidir(s2, 'APROVAR')).toMatchObject({ ok: true });
    expect(await situacao(p.id)).toBe('OFICIALIZADO');
    const snap = await migrator.snapshotVersao.findFirstOrThrow({ where: { versaoProposta: { propostaId: p.id } } });
    expect(snap.valorGlobal.toString()).toBe('2000');
    expect(snap.contas).toEqual({ '4.1.1.5.005': '2000.00' });
    const historico = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.propostas', registroId: snap.versaoPropostaId } });
    expect(historico.map((h) => h.descricao.split(':')[0])).toEqual(expect.arrayContaining(['REJEICAO_WORKFLOW', 'HOMOLOGACAO_OFICIAL']));
    // Oficializada: nada mais muda, nem o envio.
    expect(await enviar(p.id)).toMatchObject({ ok: false });
  });

  it('o banco recusa à aplicação transição fora do fluxo, mesmo por fora do caso de uso', async () => {
    const p = await proposta();
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.unidades', ${`{${p.unidadeId}}`}, true)`;
        return tx.versaoProposta.updateMany({ where: { propostaId: p.id }, data: { situacao: 'OFICIALIZADO' } });
      }),
    ).rejects.toThrow(/transicao_invalida/);
  });
});
