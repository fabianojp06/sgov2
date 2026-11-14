import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { listarEmpregados, type BlocoEmpregados, type EmpregadoTela } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA } from '@/shared/ia';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { CASO_QUADRO_PESSOAL } from './ia-casos';
import { analiseQuadroLiberada, analisarQuadroPessoal, MENSAGENS_QUADRO, obterQuadroPessoal } from './quadro-pessoal';

// Análise do quadro de pessoal (US-107) num Postgres real (Testcontainers, D12): a seed, a governança
// da IA (US-019) com o provedor falso e o listarEmpregados real do orc (sem propostas). Os blocos com
// empregados vêm de um listarEmpregados falso, no formato do contrato do orc, para conferir o que vai à IA.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: PrismaClient;
let app: PrismaClient;
let usuarioId = '';
let casoInicial: { ativo: boolean; teto: boolean } = { ativo: true, teto: false };

// "funcionalidade:ação" literal parece credencial para o GitGuardian: as permissões saem daqui.
const perm = (f: string, a: string) => [f, a].join(':');
const IA = perm(CASO_QUADRO_PESSOAL.funcionalidade, 'executar');
const CONSULTA = perm(CASO_QUADRO_PESSOAL.funcionalidade, 'consultar');
const EMPREGADOS = perm('orc.empregados', 'consultar');

const ctx = (permissoes: string[] = [IA, CONSULTA, EMPREGADOS]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'grh',
  sessaoUid: 's1',
  ip: null,
  unidadeId: null,
  unidades: [],
  permissoes: new Set(permissoes),
});

const NOMES = ['Ana Confidencial', 'Bruno Sigiloso', 'Carla Reservada'];
const empregado = (i: number, extra: Partial<EmpregadoTela> = {}): EmpregadoTela => ({
  id: `e${i}`,
  metaId: null,
  ordem: i,
  categoria: 'EMPREGADO',
  nome: NOMES[i] ?? null,
  cargoId: 'c1',
  cargo: 'C001 – Analista de orçamento',
  vinculoFuncional: 'Setor de Orçamento',
  inicio: '2027-01',
  fim: '2027-12',
  dependentes: 0,
  versao: 0,
  custoMensal: Dinheiro.de('1000.00'),
  custoPeriodo: Dinheiro.de(`${12000 + i}.00`),
  avisos: [],
  ...extra,
});
const bloco = (empregados: EmpregadoTela[]): BlocoEmpregados =>
  ({
    propostaId: 'p1',
    numero: 'TP-001/2027',
    objeto: 'Objeto com texto livre do parceiro',
    tipo: 'TERMO_PARCERIA',
    categoria: 'CONSOLIDADA',
    versaoNumero: 1,
    situacao: 'RASCUNHO',
    editavel: true,
    versaoCapa: 0,
    vigencia: { inicio: '2027-01', fim: '2027-12' },
    metas: [],
    grupos: [{ metaId: null, metaNumero: null, metaNome: null, empregados, totais: { EMPREGADO: empregados.length, ESTAGIARIO: 0, JOVEM_APRENDIZ: 0 } }],
    totais: { EMPREGADO: empregados.length, ESTAGIARIO: 0, JOVEM_APRENDIZ: 0 },
    veCusto: true,
  }) as BlocoEmpregados;

const falso = criarProvedorIAFalso();
const filtrosVistos: unknown[] = [];
let blocosFalsos = (): BlocoEmpregados[] => [bloco([empregado(0), empregado(1), empregado(2), empregado(3, { nome: null })])];
const listarFalso = async (_c: ContextoRequisicao, f: unknown) => (filtrosVistos.push(f), blocosFalsos());
const deps = (listar: typeof listarEmpregados = listarFalso as unknown as typeof listarEmpregados) => ({
  listarEmpregados: listar,
  ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }),
});
const RESPOSTA = { resumo: 'Quadro de 4 postos na TP-001/2027.', destaques: ['Uma vaga a contratar.'], alertas: [] };

const contar = async (sql: string) => (await migrator.$queryRawUnsafe<{ n: number }[]>(sql))[0]!.n;
const chamadas = () => contar(`SELECT count(*)::int AS n FROM ia_chamada WHERE caso_uso_codigo = '${CASO_QUADRO_PESSOAL.codigo}'`);
const ligarCaso = (ativo: boolean) => migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = $1, teto_mensal_usd = 10 WHERE codigo = $2`, ativo, CASO_QUADRO_PESSOAL.codigo);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedRel]);
  const c = await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_QUADRO_PESSOAL.codigo } });
  casoInicial = { ativo: c.ativo, teto: c.tetoMensalUsd.isZero() };
  app = criarPrisma(banco.urlApp);
  usuarioId = (await migrator.usuario.create({ data: { nome: 'GRH', email: 'grh@exemplo.org', login: 'grh', loginNormalizado: 'grh', senhaHash: 'x' } })).id;
  await migrator.$executeRawUnsafe(`UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100, limite_por_minuto = 100`);
}, 180_000);

beforeEach(async () => {
  falso.roteiro.estruturado = RESPOSTA;
  delete falso.roteiro.erro;
  falso.chamadas.length = 0;
  await ligarCaso(true);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('seed da análise do quadro de pessoal', () => {
  it('o caso nasce desligado e com teto zero; a funcionalidade fica no menu Relatórios para GRH, DIREX e GFIN', async () => {
    expect(casoInicial).toEqual({ ativo: false, teto: true });
    const f = await migrator.funcionalidade.findUniqueOrThrow({ where: { codigo: CASO_QUADRO_PESSOAL.funcionalidade } });
    expect(f).toMatchObject({ rota: '/rel/quadro-pessoal', exibirNoMenu: true });
    const perfis = await migrator.perfilPermissao.findMany({
      where: { funcionalidadeCodigo: CASO_QUADRO_PESSOAL.funcionalidade, acao: 'executar' },
      select: { perfil: { select: { codigo: true } } },
    });
    expect(perfis.map((p) => p.perfil.codigo).sort()).toEqual(['ANALISTA_GRH', 'DIREX', 'GFIN']);
  });

  it('a seed de novo preserva o caso ligado definido pelo Administrador', async () => {
    await executarSeeds(migrator, [seedRel]);
    expect((await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_QUADRO_PESSOAL.codigo } })).ativo).toBe(true);
  });
});

describe('analisarQuadroPessoal', () => {
  it('manda à IA só os agregados: nem nomes, nem o objeto da proposta, nem custos individuais; registra a chamada', async () => {
    const antes = await chamadas();
    const r = await analisarQuadroPessoal(ctx(), { tipo: 'TERMO_PARCERIA', proposta: ' TP-001 ' }, deps());
    expect(r).toMatchObject({ ok: true, valor: { analise: RESPOSTA, quadro: { total: { propostas: 1, aContratar: 1, custoPeriodoExibido: '48006.00' } } } });
    expect(filtrosVistos.at(-1)).toEqual({ tipo: 'TERMO_PARCERIA', proposta: 'TP-001', maximo: 120 });
    const m = falso.chamadas.at(-1)!.mensagem;
    for (const proibido of [...NOMES, 'Objeto com texto livre', '12000.00', '12001.00', '12003.00']) expect(m).not.toContain(proibido);
    expect(m).toContain('TP-001/2027');
    expect(await chamadas()).toBe(antes + 1);
  });

  it('o listarEmpregados real do orc, sem propostas: "nenhuma proposta com empregados", sem chamar a IA', async () => {
    const real = ((c: ContextoRequisicao, f: Parameters<typeof listarEmpregados>[1]) => listarEmpregados(c, f, { cliente: app, cargosDecifrados: async () => [] })) as typeof listarEmpregados;
    expect(await analisarQuadroPessoal(ctx(), {}, deps(real))).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_QUADRO.SEM_PESSOAL }] });
    expect(await obterQuadroPessoal(ctx(), {}, { listarEmpregados: real })).toMatchObject({ ok: true, valor: { propostas: [], limiteAtingido: false } });
    expect(falso.chamadas).toHaveLength(0);
  });

  it('sem a permissão do caso, sem consultar os empregados ou com filtro inválido: a mensagem certa, sem ler nem chamar a IA', async () => {
    const n = filtrosVistos.length;
    expect(await analisarQuadroPessoal(ctx([CONSULTA, EMPREGADOS]), {}, deps())).toMatchObject({ ok: false });
    expect(await analisarQuadroPessoal(ctx([IA, CONSULTA]), {}, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_QUADRO.SEM_EMPREGADOS_ORC }] });
    expect(await analisarQuadroPessoal(ctx(), { tipo: 'OUTRO' }, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_QUADRO.FILTROS_INVALIDOS }] });
    expect(await analisarQuadroPessoal(ctx(), { proposta: 'x'.repeat(101) }, deps())).toMatchObject({ ok: false });
    expect(filtrosVistos.length).toBe(n);
    expect(falso.chamadas).toHaveLength(0);
  });

  it('o botão só aparece com a permissão do caso e o caso ligado; desligado, a análise recusa sem chamar o provedor', async () => {
    expect(await analiseQuadroLiberada(ctx(), deps())).toBe(true);
    expect(await analiseQuadroLiberada(ctx([CONSULTA, EMPREGADOS]), deps())).toBe(false);
    await ligarCaso(false);
    expect(await analiseQuadroLiberada(ctx(), deps())).toBe(false);
    const n = filtrosVistos.length;
    expect(await analisarQuadroPessoal(ctx(), {}, deps())).toMatchObject({ ok: false });
    // Desligado: recusa antes da leitura dos empregados (a parte cara).
    expect(filtrosVistos.length).toBe(n);
    expect(falso.chamadas).toHaveLength(0);
  });

  it('posto com custo zerado ou com aviso do motor (ano sem premissas): o custo da proposta não vai à IA', async () => {
    const antes = blocosFalsos;
    blocosFalsos = () => [
      bloco([
        empregado(0, { custoPeriodo: Dinheiro.de('60000.00') }),
        empregado(1, { nome: null, custoPeriodo: Dinheiro.zero(), avisos: ['Sem parâmetros de 2028.'] }),
        empregado(2, { nome: null, custoPeriodo: Dinheiro.zero() }),
      ]),
    ];
    try {
      const r = await analisarQuadroPessoal(ctx(), {}, deps());
      expect(r).toMatchObject({ ok: true, valor: { quadro: { propostas: [{ custoPeriodo: null, semCusto: 'CUSTO_INCOMPLETO' }] } } });
      expect(falso.chamadas.at(-1)!.mensagem).not.toContain('60000');
    } finally {
      blocosFalsos = antes;
    }
  });

  it('erro do provedor vira a mensagem fixa, sem detalhe, e o tempo esgotado tem a dele', async () => {
    falso.roteiro.erro = 'ia.indisponivel';
    const r = await analisarQuadroPessoal(ctx(), {}, deps());
    expect(r).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'A IA está indisponível no momento. Tente de novo mais tarde.' }] });
    delete falso.roteiro.erro;
    const esgotado = AbortSignal.timeout(0);
    await new Promise((res) => setTimeout(res, 5));
    expect(await analisarQuadroPessoal(ctx(), {}, { ...deps(), sinalIa: () => esgotado })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_QUADRO.TEMPO_ESGOTADO }],
    });
  });
});
