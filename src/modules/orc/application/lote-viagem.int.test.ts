import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MENSAGENS_ALCADA } from '@/modules/adm/servidor';
import { decidirSolicitacao, obterTarefa } from '@/modules/apr';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import { obterCronograma } from './cronograma';
import type { DepsOrc } from './deps';
import { manipuladorWa02, solicitarValidacaoViagens, validadoresDasViagens } from './lote-viagem';
import { criarProposta } from './propostas';
import { incluirTeto, incluirViagem, listarViagens } from './viagens';

// Validação das viagens (US-081; plano do P28, Task 1). Como sgo_app (RLS real). A alçada WA02 tem o GFIN de
// titular e a DIREX de substituta. A oficialização da versão é feita pelo migrator (o gatilho de transição só
// barra a aplicação): o WA01 tem o teste dele.
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
const custo = { ...custoPessoalFalso([premissasExemplo(2027)], cargosExemplo()), calcularCustoPosicao: custoPessoalFalso().calcularCustoPosicao };
const comDeps = (): Partial<DepsOrc> => ({ cliente: app, estrutura, custoPessoal: custo, cargosDecifrados: custo.listarCargosExercicio });

const LANCA = ['consultar', 'incluir', 'alterar', 'excluir'];
const OPERADOR = ['orc.propostas:consultar', 'orc.propostas:incluir', ...LANCA.map((a) => `orc.viagens:${a}`), 'orc.viagens:executar', 'orc.cronograma:consultar'];
const APROVADOR = ['apr.tarefas:consultar', 'apr.tarefas:executar'];
let seq = 0;
let operador: string;
let gfin: string;
let direx: string;

async function usuario(nome: string): Promise<string> {
  const login = `viag${++seq}`;
  return (await migrator.usuario.create({ data: { nome, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId = operador, permissoes: string[] = OPERADOR): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}
const versaoCapa = async (id: string) => (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
const exigirOk = (r: { ok: boolean; erros?: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
};
/** Proposta de jan a jul de 2027 com uma viagem de 700,00 na conta 4.1.1.5.005 (100,00 por mês no cronograma). */
async function proposta() {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-07-31', categoria: 'CONSOLIDADA', cc: '9.1' },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  const id = r.valor.id;
  exigirOk(await incluirTeto(await ctx(), { propostaId: id, versaoCapa: await versaoCapa(id), contaSintetica: '4.1.1.5', valor: '10.000,00' }, comDeps()));
  exigirOk(
    await incluirViagem(
      await ctx(),
      {
        propostaId: id,
        versaoCapa: await versaoCapa(id),
        localidade: 'Brasil',
        pessoas: '1',
        dias: '1',
        valorPassagem: '700,00',
        valorDiaria: '0',
        contaPassagem: '4.1.1.5.005',
        contaDiaria: '4.1.1.5.005',
      },
      comDeps(),
    ),
  );
  return r.valor;
}
const oficializar = (id: string) => migrator.$executeRaw`UPDATE orc_versao_proposta SET situacao = 'OFICIALIZADO' WHERE proposta_id = ${id}::uuid`;
const solicitar = async (id: string, quem = operador, permissoes = OPERADOR) =>
  solicitarValidacaoViagens(await ctx(quem, permissoes), { propostaId: id, versaoCapa: await versaoCapa(id) }, comDeps());
const pendente = (numero: string) => migrator.solicitacaoAprovacao.findFirstOrThrow({ where: { descricao: { startsWith: `Viagens do TP ${numero} ` }, situacao: 'EM_APROVACAO' } });
const decidir = async (s: { id: string; versao: number }, decisao: 'APROVAR' | 'REJEITAR', justificativa?: string) =>
  decidirSolicitacao(await ctx(gfin, APROVADOR), { id: s.id, versao: s.versao, decisao, ...(justificativa ? { justificativa } : {}) }, { WA02: manipuladorWa02() }, { cliente: app });
const situacoes = async (id: string) =>
  (await migrator.viagemProposta.findMany({ where: { versaoProposta: { propostaId: id } }, include: { loteViagem: { select: { situacao: true } } } })).map((v) => v.loteViagem?.situacao ?? 'PENDENTE');
const blocoDe = async (id: string) => (await listarViagens(await ctx(), {}, comDeps())).find((b) => b.propostaId === id)!;
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  operador = await usuario('Operador de Viagens');
  gfin = await usuario('Gestor Financeiro');
  direx = await usuario('Diretoria');
  await migrator.alcadaAprovacao.create({ data: { fluxo: 'WA02', titularId: gfin, substitutoId: direx, criadaEm: new Date() } });
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

describe('solicitarValidacaoViagens (UC6.02)', () => {
  it('só com a versão Oficializada (Review Focus 2); o pedido leva as viagens a Em Validação e as tira do cronograma até a validação (Review Focus 1)', async () => {
    const p = await proposta();
    expect(await solicitar(p.id)).toEqual(erroGeral(M.VIAGENS_SO_OFICIALIZADA));
    await oficializar(p.id);
    expect(await validadoresDasViagens(await ctx(), comDeps())).toEqual({ titular: expect.stringMatching(/^Gestor Financeiro \(viag\d+\)$/), substituto: 'Diretoria' });
    expect((await blocoDe(p.id)).validavel).toBe(true);
    const antes = (await obterCronograma(await ctx(), p.id, {}, comDeps()))!;
    expect(antes.viagensNaoValidadas).toBe(true);
    expect(antes.total.paraString()).toBe('0.00');

    expect(await solicitar(p.id)).toEqual({ ok: true, valor: { numero: p.numero } });
    expect(await situacoes(p.id)).toEqual(['EM_VALIDACAO']);
    expect(await pendente(p.numero)).toMatchObject({ fluxo: 'WA02', aprovadorId: gfin, alvoTipo: 'LOTE_VIAGEM', solicitanteId: operador });
    expect(await blocoDe(p.id)).toMatchObject({ validavel: false, grupos: [{ viagens: [{ validacao: 'EM_VALIDACAO' }] }] });
    expect(await solicitar(p.id)).toEqual(erroGeral(M.VIAGENS_EM_VALIDACAO));

    const s = await pendente(p.numero);
    const aberta = await obterTarefa(await ctx(gfin, APROVADOR), s.id, { WA02: manipuladorWa02() }, { cliente: app });
    expect(aberta?.resumo).toEqual([
      { rotulo: 'Viagens', valor: '1' },
      { rotulo: 'Conta 4.1.1.5.005', valor: 'R$ 700,00' },
      { rotulo: 'Custo das viagens', valor: 'R$ 700,00' },
    ]);
    expect(await decidir(s, 'APROVAR')).toMatchObject({ ok: true });
    expect(await situacoes(p.id)).toEqual(['VALIDADO']);
    const depois = (await obterCronograma(await ctx(), p.id, {}, comDeps()))!;
    expect(depois.viagensNaoValidadas).toBe(false);
    expect(depois.total.paraString()).toBe('700.00');
    expect(depois.linhas.filter((l) => l.tipo === 'MES').map((l) => l.desembolso.paraString())).toEqual(Array(7).fill('100.00'));
    expect(await solicitar(p.id)).toEqual(erroGeral(M.VIAGENS_SEM_PENDENTES));
    const historico = await migrator.historicoOperacao.findMany({ where: { funcionalidade: 'orc.viagens', descricao: { startsWith: 'HOMOLOGACAO_VIAGENS' } } });
    expect(historico).toHaveLength(1);
  });

  it('rejeitar devolve as linhas, que vão num novo lote (Review Focus 3)', async () => {
    const p = await proposta();
    await oficializar(p.id);
    exigirOk(await solicitar(p.id));
    const s1 = await pendente(p.numero);
    expect(await decidir(s1, 'REJEITAR', 'A diária de Brasília está acima da tabela.')).toMatchObject({ ok: true });
    expect(await situacoes(p.id)).toEqual(['REJEITADO']);
    expect((await obterCronograma(await ctx(), p.id, {}, comDeps()))!.viagensNaoValidadas).toBe(true);
    expect((await blocoDe(p.id)).validavel).toBe(true);
    exigirOk(await solicitar(p.id));
    const s2 = await pendente(p.numero);
    expect(s2.alvoId).not.toBe(s1.alvoId);
    expect(await situacoes(p.id)).toEqual(['EM_VALIDACAO']);
    // A decisão repetida no lote antigo não mexe em nada (o alvo mudou).
    expect(await migrator.loteViagem.count({ where: { versaoProposta: { propostaId: p.id } } })).toBe(2);
  });

  it('sem aprovador (E2), o operador como único aprovador (E4) e sem a ação executar (Review Focus 4 e 5)', async () => {
    const p = await proposta();
    await oficializar(p.id);
    await migrator.usuario.updateMany({ where: { id: { in: [gfin, direx] } }, data: { ativo: false } });
    expect(await validadoresDasViagens(await ctx(), comDeps())).toEqual({ motivo: MENSAGENS_ALCADA.SEM_APROVADOR('WA02') });
    expect(await solicitar(p.id)).toEqual(erroGeral(MENSAGENS_ALCADA.SEM_APROVADOR('WA02')));
    await migrator.usuario.updateMany({ where: { id: { in: [gfin, direx] } }, data: { ativo: true } });

    const alcada = await migrator.alcadaAprovacao.findFirstOrThrow({ where: { fluxo: 'WA02', ativa: true } });
    await migrator.alcadaAprovacao.update({ where: { id: alcada.id }, data: { titularId: operador } });
    await migrator.usuario.update({ where: { id: direx }, data: { ativo: false } });
    try {
      expect(await validadoresDasViagens(await ctx(), comDeps())).toEqual({ motivo: MENSAGENS_ALCADA.MESMO_USUARIO('WA02') });
      expect(await solicitar(p.id)).toEqual(erroGeral(MENSAGENS_ALCADA.MESMO_USUARIO('WA02')));
    } finally {
      await migrator.alcadaAprovacao.update({ where: { id: alcada.id }, data: { titularId: gfin } });
    }
    await expect(solicitar(p.id, operador, OPERADOR.filter((x) => x !== 'orc.viagens:executar'))).rejects.toThrow();
    expect(await situacoes(p.id)).toEqual(['PENDENTE']);
  });

});
