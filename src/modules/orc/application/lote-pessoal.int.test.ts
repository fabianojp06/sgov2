import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MENSAGENS_ALCADA } from '@/modules/adm/servidor';
import { decidirSolicitacao, obterTarefa } from '@/modules/apr';
import { CENTROS_CUSTO_EXEMPLO, cargosExemplo, custoPessoalFalso, estruturaFinanceiraFalsa, premissasExemplo, type NoCentroCusto } from '@/modules/cad/servidor';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_ORC as M } from '../domain/mensagens';
import type { DepsOrc } from './deps';
import { alterarEmpregado, incluirEmpregado, listarEmpregados } from './empregados';
import { aprovadoresDoLote, finalizarLotePessoal, manipuladorWa05, situacaoDoLote } from './lote-pessoal';
import { criarProposta, novaVersaoProposta } from './propostas';
import { incluirQtde, listarQtdes } from './qtde-empregados';

// Lote de pessoal para homologação (US-080; plano do P27, Task 1). Como sgo_app (RLS real). A alçada WA05 tem o GFIN
// de titular e a DIREX de substituta; o C2 é o falso do cad (premissas de 2027).
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
const GRH = [
  'orc.propostas:consultar',
  'orc.propostas:incluir',
  ...LANCA.map((a) => `orc.empregados:${a}`),
  'orc.empregados:executar',
  ...LANCA.map((a) => `orc.qtde_empregados:${a}`),
];
const APROVADOR = ['apr.tarefas:consultar', 'apr.tarefas:executar'];
let seq = 0;
let grh: string;
let gfin: string;
let direx: string;

async function usuario(nome: string): Promise<string> {
  const login = `lote${++seq}`;
  return (await migrator.usuario.create({ data: { nome, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
}
const unidadesDe = async (usuarioId: string) =>
  (await migrator.usuarioUnidade.findMany({ where: { usuarioId, unidade: { ativo: true } }, select: { unidadeId: true } })).map((u) => u.unidadeId);
async function ctx(usuarioId = grh, permissoes: string[] = GRH): Promise<ContextoRequisicao> {
  return { usuarioId, usuarioRotulo: 'u', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes), unidades: await unidadesDe(usuarioId), unidadeId: null };
}
const versaoCapa = async (id: string) => (await migrator.propostaTp.findUniqueOrThrow({ where: { id } })).versao;
const exigirOk = (r: { ok: boolean; erros?: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
};
async function proposta(comEmpregado = true) {
  const numero = `TP-${String(++seq).padStart(3, '0')}/2027`;
  const r = await criarProposta(
    await ctx(),
    { tipo: 'TERMO_PARCERIA', numero, objeto: `Objeto ${numero}`, parceiro: '', inicio: '2027-01-01', fim: '2027-12-31', categoria: 'CONSOLIDADA', cc: '9.1' },
    comDeps(),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  const versaoId = (await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: r.valor.id } })).id;
  if (comEmpregado) {
    exigirOk(
      await incluirEmpregado(
        await ctx(),
        {
          propostaId: r.valor.id,
          versaoCapa: await versaoCapa(r.valor.id),
          categoria: 'EMPREGADO',
          nome: 'Ana',
          cargoId: C001,
          inicio: '2027-01',
          fim: '2027-12',
          dependentes: '0',
        },
        comDeps(),
      ),
    );
  }
  return { ...r.valor, versaoId };
}
const finalizar = async (id: string, quem = grh, permissoes = GRH) =>
  finalizarLotePessoal(await ctx(quem, permissoes), { propostaId: id, versaoCapa: await versaoCapa(id) }, comDeps());
const pendente = (numero: string) => migrator.solicitacaoAprovacao.findFirstOrThrow({ where: { descricao: { startsWith: `Pessoal do TP ${numero} ` }, situacao: 'EM_APROVACAO' } });
const decidir = async (s: { id: string; versao: number }, decisao: 'APROVAR' | 'REJEITAR', justificativa?: string) =>
  decidirSolicitacao(
    await ctx(gfin, APROVADOR),
    { id: s.id, versao: s.versao, decisao, ...(justificativa ? { justificativa } : {}) },
    { WA05: manipuladorWa05(comDeps()) },
    { cliente: app },
  );
const erroGeral = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  grh = await usuario('Analista GRH');
  gfin = await usuario('Gestor Financeiro');
  direx = await usuario('Diretoria');
  await migrator.alcadaAprovacao.create({ data: { fluxo: 'WA05', titularId: gfin, substitutoId: direx, criadaEm: new Date() } });
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

describe('finalizarLotePessoal (UC6.01)', () => {
  it('o modal mostra os aprovadores; finalizar leva o lote a Em Aprovação e roteia ao titular; o pessoal trava (Review Focus 1)', async () => {
    expect(await aprovadoresDoLote(await ctx(), comDeps())).toEqual({ titular: expect.stringMatching(/^Gestor Financeiro \(lote\d+\)$/), substituto: 'Diretoria' });
    const p = await proposta();
    expect(await finalizar(p.id)).toEqual({ ok: true, valor: { numero: p.numero } });
    expect(await situacaoDoLote(migrator, p.versaoId)).toBe('EM_APROVACAO');
    expect(await pendente(p.numero)).toMatchObject({ fluxo: 'WA05', aprovadorId: gfin, alvoTipo: 'LOTE_PESSOAL' });
    const e = await migrator.empregadoProposta.findFirstOrThrow({ where: { versaoPropostaId: p.versaoId } });
    expect(
      await incluirEmpregado(
        await ctx(),
        { propostaId: p.id, versaoCapa: await versaoCapa(p.id), categoria: 'ESTAGIARIO', nome: '', cargoId: C001, inicio: '2027-01', fim: '2027-02', dependentes: '0' },
        comDeps(),
      ),
    ).toEqual(erroGeral(M.LOTE_PESSOAL_TRAVADO('em aprovação')));
    expect(
      await alterarEmpregado(
        await ctx(),
        { id: e.id, versao: 0, versaoCapa: await versaoCapa(p.id), categoria: 'EMPREGADO', nome: 'Ana Maria', cargoId: C001, inicio: '2027-01', fim: '2027-12', dependentes: '0' },
        comDeps(),
      ),
    ).toEqual(erroGeral(M.LOTE_PESSOAL_TRAVADO('em aprovação')));
    expect(await incluirQtde(await ctx(), { propostaId: p.id, versaoCapa: await versaoCapa(p.id), inicio: '2027-01', fim: '2027-06', documento: 'AP-1' }, comDeps())).toEqual(
      erroGeral(M.LOTE_PESSOAL_TRAVADO('em aprovação')),
    );
    expect(await finalizar(p.id)).toEqual(erroGeral(M.LOTE_JA_FINALIZADO));
    // As telas de pessoal ficam só leitura: empregados e quantitativos (RF_APR_REQ_008, revisão 12.12).
    const daProposta = <T extends { propostaId: string }>(bs: readonly T[]) => bs.find((b) => b.propostaId === p.id);
    expect(daProposta(await listarEmpregados(await ctx(), {}, comDeps()))).toMatchObject({ editavel: false, lote: 'EM_APROVACAO' });
    expect(daProposta(await listarQtdes(await ctx(), {}, comDeps()))).toMatchObject({ editavel: false });
  });

  it('sem empregado, sem aprovador e sem a ação executar (Review Focus 5)', async () => {
    const p = await proposta(false);
    expect(await finalizar(p.id)).toEqual(erroGeral(M.LOTE_SEM_EMPREGADOS));
    await migrator.$executeRaw`UPDATE unidade SET ativo = false WHERE cc IS NOT NULL`;
    await migrator.usuario.updateMany({ where: { id: { in: [gfin, direx] } }, data: { ativo: false } });
    const q = await proposta();
    expect(await finalizar(q.id)).toEqual(erroGeral(MENSAGENS_ALCADA.SEM_APROVADOR('WA05')));
    // O modal mostra o motivo no lugar do botão (revisão 12.12).
    expect(await aprovadoresDoLote(await ctx(), comDeps())).toEqual({ motivo: MENSAGENS_ALCADA.SEM_APROVADOR('WA05') });
    await migrator.usuario.updateMany({ where: { id: { in: [gfin, direx] } }, data: { ativo: true } });
    await expect(
      finalizar(
        q.id,
        grh,
        GRH.filter((x) => x !== 'orc.empregados:executar'),
      ),
    ).rejects.toThrow();
  });
});

describe('homologar e rejeitar na Central de Tarefas (FA-A e FA-B)', () => {
  it('rejeitar devolve o lote para edição (Review Focus 3); homologar trava de vez; o resumo traz a contagem e o custo', async () => {
    const p = await proposta();
    exigirOk(await finalizar(p.id));
    const s1 = await pendente(p.numero);
    const aberta = await obterTarefa(await ctx(gfin, APROVADOR), s1.id, { WA05: manipuladorWa05(comDeps()) }, { cliente: app });
    expect(aberta?.resumo).toEqual(
      expect.arrayContaining([
        { rotulo: 'Empregado', valor: '1' },
        { rotulo: 'Custo do pessoal no período', valor: 'R$ 90.000,00' },
      ]),
    );
    expect(await decidir(s1, 'REJEITAR', 'Falta o estagiário da meta 2.')).toMatchObject({ ok: true });
    expect(await situacaoDoLote(migrator, p.versaoId)).toBe('EM_ELABORACAO');
    exigirOk(
      await incluirEmpregado(
        await ctx(),
        { propostaId: p.id, versaoCapa: await versaoCapa(p.id), categoria: 'ESTAGIARIO', nome: '', cargoId: C001, inicio: '2027-01', fim: '2027-02', dependentes: '0' },
        comDeps(),
      ),
    );
    exigirOk(await finalizar(p.id));
    expect(await decidir(await pendente(p.numero), 'APROVAR')).toMatchObject({ ok: true });
    expect(await situacaoDoLote(migrator, p.versaoId)).toBe('HOMOLOGADO');
    expect(
      await incluirEmpregado(
        await ctx(),
        { propostaId: p.id, versaoCapa: await versaoCapa(p.id), categoria: 'ESTAGIARIO', nome: '', cargoId: C001, inicio: '2027-01', fim: '2027-02', dependentes: '0' },
        comDeps(),
      ),
    ).toEqual(erroGeral(M.LOTE_PESSOAL_TRAVADO('homologado')));
  });

  it('a nova versão nasce com o pessoal em elaboração (Review Focus 4)', async () => {
    const p = await proposta();
    exigirOk(await finalizar(p.id));
    expect(await decidir(await pendente(p.numero), 'APROVAR')).toMatchObject({ ok: true });
    exigirOk(await novaVersaoProposta(await ctx(), { id: p.id, versao: await versaoCapa(p.id) }, comDeps()));
    const v2 = await migrator.versaoProposta.findFirstOrThrow({ where: { propostaId: p.id, numero: 2 } });
    expect(await situacaoDoLote(migrator, v2.id)).toBe('EM_ELABORACAO');
    exigirOk(
      await incluirEmpregado(
        await ctx(),
        { propostaId: p.id, versaoCapa: await versaoCapa(p.id), categoria: 'ESTAGIARIO', nome: '', cargoId: C001, inicio: '2027-01', fim: '2027-02', dependentes: '0' },
        comDeps(),
      ),
    );
  });
});
