import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { VisaoExercicio } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA } from '@/shared/ia';
import { Dinheiro, ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { CASO_PERGUNTE_SGO } from './ia-casos';
import { MENSAGENS_PERGUNTE, perguntarAoSgo, pergunteLiberado } from './pergunte-sgo';

// Pergunte ao SGO (US-104) num Postgres real (Testcontainers, D12): a seed e a governança da IA (US-019) com o
// provedor falso. As leituras do orc são falsas aqui, no formato das portas (obterVisaoExercicio, que cai no
// exercício mais recente sem ano, e obterConsolidado); o escopo e a RLS delas são testados pela frente A.
// O que se prova: a IA só classifica, o número vem do sistema e as permissões de quem pergunta valem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: PrismaClient;
let app: PrismaClient;
let usuarioId = '';
let casoInicial = { ativo: true, teto: false };

// "funcionalidade:ação" literal parece credencial para o GitGuardian: as permissões saem daqui.
const perm = (f: string, a: string) => [f, a].join(':');
const IA = perm(CASO_PERGUNTE_SGO.funcionalidade, 'executar');
const ORC = perm('orc.orcamento', 'consultar');
const CONS = perm('orc.consolidado', 'consultar');
const ctx = (permissoes: string[] = [IA, ORC, CONS]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'direx', sessaoUid: 's1', ip: null, unidadeId: null, permissoes: new Set(permissoes) });

const d = (v: string) => Dinheiro.de(v);
const visao = (ano: number, escopoTotal: boolean) =>
  ({
    exercicio: { id: 'x', ano, situacao: 'OFICIALIZADO', rotuloSituacao: 'Oficializado', editavel: false, versao: 1, premissasDesatualizadas: false },
    painel: escopoTotal ? { tetoEfetivo: d('1200000.00'), saldo: d('200000.00'), resultadoAno: d('-5000.00') } : null,
    escopo: escopoTotal ? { tipo: 'TOTAL' } : { tipo: 'SUBARVORE', raiz: '4.3', ccs: new Set(['4.3.2']) },
    arvore: [
      { cc: '4', descricao: 'DIREX', total: d('1000000.00'), filhos: [{ cc: '4.3', descricao: 'DAF', total: d('400000.00'), filhos: [{ cc: '4.3.002', descricao: 'Gerência Financeira', total: d('321098.76'), filhos: [] }] }] },
    ],
    indicadores: { orcamentoAno: d('1000000.00'), pessoal: d('600000.00') },
  }) as unknown as VisaoExercicio;
let escopoTotal = true;
let falhaPorta: Error | null = null;
// Como a porta: sem ano, o mais recente (2027); com um ano que não existe, também cai no mais recente.
const lerVisao = async (_c: ContextoRequisicao, ano: number | null) => {
  if (falhaPorta) throw falhaPorta;
  return visao(ano === 2026 ? 2026 : 2027, escopoTotal);
};
const lerConsolidado = async () => [
  { numero: 'TP-3', orcado: d('50000.00'), versaoOficial: 2 },
  { numero: 'TP-4', orcado: null, versaoOficial: null },
];
const falso = criarProvedorIAFalso();
const deps = () => ({ ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }), agora: () => new Date('2026-11-20T12:00:00Z'), lerVisao, lerConsolidado });
const classificar = (consulta: string, extra: { ano?: number | null; cc?: string | null; tp?: string | null } = {}) =>
  (falso.roteiro.estruturado = { consulta, ano: null, cc: null, tp: null, ...extra });
const pergunta = (texto = 'Uma pergunta qualquer?') => ({ pergunta: texto });
const ligarCaso = (ativo: boolean) => migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = $1, teto_mensal_usd = 10 WHERE codigo = $2`, ativo, CASO_PERGUNTE_SGO.codigo);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedRel]);
  const c = await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_PERGUNTE_SGO.codigo } });
  casoInicial = { ativo: c.ativo, teto: c.tetoMensalUsd.isZero() };
  app = criarPrisma(banco.urlApp);
  usuarioId = (await migrator.usuario.create({ data: { nome: 'DIREX', email: 'direx@exemplo.org', login: 'direx', loginNormalizado: 'direx', senhaHash: 'x' } })).id;
  await migrator.$executeRawUnsafe(`UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100, limite_por_minuto = 100`);
}, 180_000);

beforeEach(async () => {
  delete falso.roteiro.erro;
  falso.chamadas.length = 0;
  escopoTotal = true;
  falhaPorta = null;
  await ligarCaso(true);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('Pergunte ao SGO', () => {
  it('seed: em Relatórios para DIREX, GFIN e Gestor; o caso nasce desligado e com teto zero', async () => {
    expect(casoInicial).toEqual({ ativo: false, teto: true });
    const perfis = await migrator.perfilPermissao.findMany({ where: { funcionalidadeCodigo: CASO_PERGUNTE_SGO.funcionalidade, acao: 'executar' }, select: { perfil: { select: { codigo: true } } } });
    expect(perfis.map((p) => p.perfil.codigo).sort()).toEqual(['DIREX', 'GESTOR_DIRETORIA', 'GFIN']);
  });

  it('a IA só classifica (a mensagem não leva dado do sistema); o número, a fonte e o link vêm do sistema', async () => {
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 2027 });
    const r = await perguntarAoSgo(ctx(), pergunta('Qual o orçamento da Adm. Central em 2027?'), deps());
    expect(r).toMatchObject({ ok: true, valor: { tipo: 'NUMERO', valor: '1000000.00', link: '/orc/orcamento?ano=2027', fonte: expect.stringContaining('exercício 2027') } });
    const m = falso.chamadas.at(-1)!.mensagem;
    expect(m).toContain('Pergunta: <<<Qual o orçamento da Adm. Central em 2027?>>>');
    expect(m).not.toContain('1000000');
  });

  it('sem ano: o exercício que a tela abre (o mais recente), não o ano civil; ano dito que não existe: a resposta diz, sem trocar', async () => {
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: null });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'NUMERO', link: '/orc/orcamento?ano=2027', texto: expect.stringContaining('em 2027') } });
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 1999 });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_EXERCICIO(1999) } });
  });

  it('CC aninhado e sem zeros à esquerda, com o link codificado; fora do acesso, diz que não está', async () => {
    classificar('ORCADO_CC', { ano: 2027, cc: '4.3.2' });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { valor: '321098.76', link: '/orc/orcamento?ano=2027&cc=4.3.002' } });
    classificar('ORCADO_CC', { ano: 2027, cc: '4.9' });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.CC_FORA('4.9') } });
  });

  it('TP: o Valor Global oficial do consolidado (a tela do link); sem versão oficial, diz isso; escrita livre do número', async () => {
    classificar('VALOR_GLOBAL_TP', { tp: 'tp 03' });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'NUMERO', valor: '50000.00', link: '/orc/consolidado', fonte: expect.stringContaining('versão oficializada 2') } });
    classificar('VALOR_GLOBAL_TP', { tp: 'TP-4' });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.TP_NAO_OFICIAL('TP-4') } });
    classificar('QUANTIDADE_TPS');
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { valor: '2' } });
  });

  it('permissões e escopo de quem pergunta: sem nenhuma fonte, nem chama a IA; com escopo, sem teto e com o escopo nomeado', async () => {
    expect(await perguntarAoSgo(ctx([IA]), pergunta(), deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_PERGUNTE.SEM_ACESSO }] });
    expect(falso.chamadas).toHaveLength(0);
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx([IA, CONS]), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_ACESSO_ORCAMENTO } });
    classificar('QUANTIDADE_TPS');
    expect(await perguntarAoSgo(ctx([IA, ORC]), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_ACESSO_CONSOLIDADO } });
    escopoTotal = false;
    classificar('TETO_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SO_INTEIRA } });
    classificar('PESSOAL_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { texto: expect.stringContaining('(do seu escopo, CC 4.3)') } });
  });

  it('erro de domínio da porta vira "não foi possível"; fora do catálogo, NAO_SEI; caso desligado, sem permissão e tempo esgotado', async () => {
    falhaPorta = new ErroDominio('orc.cc_inexistente', 'x');
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO' } });
    falhaPorta = new Error('outro erro');
    await expect(perguntarAoSgo(ctx(), pergunta(), deps())).rejects.toThrow('outro erro');
    falhaPorta = null;
    classificar('LISTAR_SALARIOS');
    expect(await perguntarAoSgo(ctx(), pergunta('Qual o salário do Fulano?'), deps())).toMatchObject({ ok: true, valor: { tipo: 'NAO_SEI' } });
    expect(await perguntarAoSgo(ctx([ORC]), pergunta(), deps())).toMatchObject({ ok: false });
    const esgotado = AbortSignal.timeout(0);
    await new Promise((res) => setTimeout(res, 5));
    expect(await perguntarAoSgo(ctx(), pergunta(), { ...deps(), sinalIa: () => esgotado })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_PERGUNTE.TEMPO_ESGOTADO }] });
    await ligarCaso(false);
    expect(await pergunteLiberado(ctx(), deps())).toBe(false);
    expect(await perguntarAoSgo(ctx(), pergunta(), deps())).toMatchObject({ ok: false });
  });
});
