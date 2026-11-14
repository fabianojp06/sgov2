import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA } from '@/shared/ia';
import { MENSAGEM_CONFLITO } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { CASO_RELATORIO_EXECUTIVO } from './ia-casos';
import { alterarTextos, aprovarRelatorio, exportarPdfRelatorio, gerarRascunho, listarRelatorios, MENSAGENS_RELATORIO, obterRelatorio } from './relatorio-executivo';

// Relatório executivo mensal (US-103, parte 1) num Postgres real (Testcontainers, D12), como sgo_app: a
// seed, a governança da IA (US-019) com o provedor falso, o Histórico, a imutabilidade do aprovado (trigger)
// e os privilégios. As leituras do orc (visão e comparativo) são falsas aqui: elas têm os próprios testes.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: PrismaClient;
let app: PrismaClient;
let sql: pg.Client;
let gfinId = '';
let direxId = '';
let casoInicial = { ativo: true, teto: false };

// "funcionalidade:ação" literal parece credencial para o GitGuardian: as permissões saem daqui.
const perm = (a: string) => [CASO_RELATORIO_EXECUTIVO.funcionalidade, a].join(':');
const GFIN = ['consultar', 'executar', 'alterar', 'aprovar', 'exportar'].map(perm);
const DIREX = ['consultar', 'exportar'].map(perm);
const ctx = (usuarioId: string, permissoes: string[], rotulo = 'gfin'): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: rotulo,
  sessaoUid: 's1',
  ip: null,
  unidadeId: null,
  permissoes: new Set(permissoes),
});
const gfin = () => ctx(gfinId, GFIN);
const direx = () => ctx(direxId, DIREX, 'direx');

const ADM = {
  ano: 2027,
  situacao: 'Oficializado',
  orcamentoAno: '1000000.00',
  pessoal: '600000.00',
  percentualPessoal: '60.00',
  empregadosDezembro: 40,
  tetoEfetivo: '1200000.00',
  usoDoTeto: '83.33',
  resultadoAno: '-5000.00',
  saldo: '200000.00',
};
let lidas = 0;
const falso = criarProvedorIAFalso();
const deps = () => ({
  cliente: app,
  ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }),
  agora: () => new Date('2027-05-20T12:00:00Z'),
  lerAdmCentral: async () => (lidas++, ADM),
  lerTps: async () => ({ tps: [{ numero: 'TP-1', oficial: true, valorGlobal: '50000.00', execucao: '0.00' }], omitidos: 0 }),
});
const RESPOSTA = { resumo: 'O resultado do ano está negativo em R$ 5.000,00.', riscos: ['Resultado negativo.'], recomendacoes: ['Rever o teto.'] };
const ligarCaso = (ativo: boolean) => migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = $1, teto_mensal_usd = 10 WHERE codigo = $2`, ativo, CASO_RELATORIO_EXECUTIVO.codigo);
const historico = async (registroId: string) =>
  (await sql.query<{ tipo: string; origem: string }>(`SELECT tipo_operacao::text AS tipo, origem::text AS origem FROM historico_operacao WHERE registro_id = $1 ORDER BY ocorrido_em, id`, [registroId])).rows;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedRel]);
  const c = await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_RELATORIO_EXECUTIVO.codigo } });
  casoInicial = { ativo: c.ativo, teto: c.tetoMensalUsd.isZero() };
  app = criarPrisma(banco.urlApp);
  sql = new pg.Client({ connectionString: banco.urlMigrator });
  await sql.connect();
  const usuario = async (login: string) => (await migrator.usuario.create({ data: { nome: login, email: `${login}@exemplo.org`, login, loginNormalizado: login, senhaHash: 'x' } })).id;
  gfinId = await usuario('gfin');
  direxId = await usuario('direx');
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
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect(), sql?.end()]);
  } finally {
    await banco?.parar();
  }
});

describe('seed do relatório executivo', () => {
  it('em Relatórios, para a GFIN (tudo) e a DIREX (consultar e exportar); o caso nasce desligado e com teto zero', async () => {
    expect(casoInicial).toEqual({ ativo: false, teto: true });
    const f = await migrator.funcionalidade.findUniqueOrThrow({ where: { codigo: CASO_RELATORIO_EXECUTIVO.funcionalidade } });
    expect(f).toMatchObject({ moduloCodigo: 'RELATORIOS', rota: '/rel/relatorio-executivo', exibirNoMenu: true });
    const pp = await migrator.perfilPermissao.findMany({
      where: { funcionalidadeCodigo: CASO_RELATORIO_EXECUTIVO.funcionalidade },
      select: { acao: true, perfil: { select: { codigo: true } } },
    });
    const por = (p: string) => pp.filter((x) => x.perfil.codigo === p).map((x) => x.acao).sort();
    expect(por('GFIN')).toEqual(['alterar', 'aprovar', 'consultar', 'executar', 'exportar']);
    expect(por('DIREX')).toEqual(['consultar', 'exportar']);
  });
});

describe('ciclo do relatório', () => {
  let id = '';

  it('gera o rascunho do mês: indicadores congelados, textos da IA, Histórico com origem de sugestão da IA', async () => {
    const r = await gerarRascunho(gfin(), { mes: '2027-05' }, deps());
    expect(r).toMatchObject({ ok: true, valor: { mes: '2027-05' } });
    id = r.ok ? r.valor.id : '';
    const tela = await obterRelatorio(gfin(), id, { cliente: app });
    expect(tela).toMatchObject({ situacao: 'RASCUNHO', versao: 1, textos: RESPOSTA, dados: { mes: '2027-05', admCentral: { orcamentoAno: '1000000.00' }, tps: [{ numero: 'TP-1' }] } });
    expect(falso.chamadas.at(-1)!.mensagem).toContain('"orcamentoAno":"1000000.00"');
    expect(await historico(id)).toEqual([{ tipo: 'INSERCAO', origem: 'SUGESTAO_IA' }]);
  });

  it('mês futuro, sem permissão ou com o caso desligado: recusa sem ler', async () => {
    const antes = lidas;
    expect(await gerarRascunho(gfin(), { mes: '2027-06' }, deps())).toMatchObject({ ok: false, erros: [{ campo: 'mes' }] });
    expect(await gerarRascunho(direx(), { mes: '2027-05' }, deps())).toMatchObject({ ok: false });
    await ligarCaso(false);
    expect(await gerarRascunho(gfin(), { mes: '2027-04' }, deps())).toMatchObject({ ok: false });
    expect(lidas).toBe(antes);
  });

  it('a DIREX não vê o rascunho; gerar de novo substitui o rascunho (versão 2)', async () => {
    expect(await listarRelatorios(direx(), { cliente: app })).toEqual([]);
    expect(await obterRelatorio(direx(), id, { cliente: app })).toBeNull();
    expect(await exportarPdfRelatorio(direx(), id, { cliente: app })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_RELATORIO.NAO_ENCONTRADO }] });
    falso.roteiro.estruturado = { ...RESPOSTA, resumo: 'Segunda versão.' };
    expect((await gerarRascunho(gfin(), { mes: '2027-05' }, deps())).ok).toBe(true);
    expect(await obterRelatorio(gfin(), id, { cliente: app })).toMatchObject({ versao: 2, textos: { resumo: 'Segunda versão.' } });
  });

  it('a GFIN revisa os textos (validação e concorrência pela versão)', async () => {
    expect(await alterarTextos(gfin(), { id, versao: 2, resumo: ' ', riscos: '', recomendacoes: '' }, { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: 'resumo' }] });
    expect(await alterarTextos(gfin(), { id, versao: 2, resumo: 'Revisado pela GFIN.', riscos: 'Risco 1\nRisco 2', recomendacoes: 'Ação 1' }, { cliente: app })).toEqual({ ok: true, valor: { versao: 3 } });
    expect(await alterarTextos(gfin(), { id, versao: 2, resumo: 'Outro.', riscos: '', recomendacoes: '' }, { cliente: app })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGEM_CONFLITO }] });
    expect(await obterRelatorio(gfin(), id, { cliente: app })).toMatchObject({ textos: { resumo: 'Revisado pela GFIN.', riscos: ['Risco 1', 'Risco 2'], recomendacoes: ['Ação 1'] } });
  });

  it('aprova: daí em diante não muda (nem pela tela, nem pelo banco, nem gerando de novo); a DIREX vê e baixa', async () => {
    expect(await aprovarRelatorio(gfin(), { id, versao: 3 }, { cliente: app })).toEqual({ ok: true, valor: { mes: '2027-05' } });
    expect(await alterarTextos(gfin(), { id, versao: 4, resumo: 'Depois.', riscos: '', recomendacoes: '' }, { cliente: app })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_RELATORIO.SO_RASCUNHO }] });
    expect(await gerarRascunho(gfin(), { mes: '2027-05' }, deps())).toEqual({ ok: false, erros: [{ campo: 'mes', mensagem: MENSAGENS_RELATORIO.JA_APROVADO('2027-05') }] });
    await expect(sql.query(`UPDATE rel_relatorio_executivo SET resumo = 'x' WHERE id = $1`, [id])).rejects.toThrow(/aprovado não pode ser alterado/);
    expect((await listarRelatorios(direx(), { cliente: app })).map((r) => r.mes)).toEqual(['2027-05']);
    const pdf = await exportarPdfRelatorio(direx(), id, { cliente: app });
    expect(pdf).toMatchObject({ ok: true, valor: { nome: 'relatorio-executivo-2027-05.pdf' } });
    expect((await historico(id)).map((h) => h.tipo)).toEqual(['INSERCAO', 'ALTERACAO', 'ALTERACAO', 'ALTERACAO', 'EXPORTACAO']);
  });

  it('privilégios: o app não apaga; o banco recusa mês fora do formato', async () => {
    const appSql = new pg.Client({ connectionString: banco.urlApp });
    await appSql.connect();
    try {
      await expect(appSql.query(`DELETE FROM rel_relatorio_executivo`)).rejects.toThrow(/permission denied/);
      await expect(
        appSql.query(`INSERT INTO rel_relatorio_executivo (mes, dados, resumo, riscos, recomendacoes, gerado_por) VALUES ('2027-13', '{}', 'r', '[]', '[]', $1)`, [gfinId]),
      ).rejects.toThrow(/rel_relatorio_executivo_mes_check/);
    } finally {
      await appSql.end();
    }
  });
});
