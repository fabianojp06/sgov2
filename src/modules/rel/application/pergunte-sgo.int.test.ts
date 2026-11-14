import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { VisaoExercicio } from '@/modules/orc';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA } from '@/shared/ia';
import { Dinheiro } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { CASO_PERGUNTE_SGO } from './ia-casos';
import { MENSAGENS_PERGUNTE, perguntarAoSgo, pergunteLiberado } from './pergunte-sgo';

// Pergunte ao SGO (US-104) num Postgres real (Testcontainers, D12): a seed e a governança da IA (US-019) com o
// provedor falso. As leituras do orc são falsas aqui (as portas têm os próprios testes); o que se prova é que
// a IA só classifica, que o número vem do sistema e que as permissões e o escopo de quem pergunta valem.
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
const visao = (escopoTotal = true) =>
  ({
    exercicio: { id: 'x', ano: 2027, situacao: 'OFICIALIZADO', rotuloSituacao: 'Oficializado', editavel: false, versao: 1, premissasDesatualizadas: false },
    painel: escopoTotal ? { tetoEfetivo: d('1200000.00'), saldo: d('200000.00'), resultadoAno: d('-5000.00') } : null,
    escopo: escopoTotal ? { tipo: 'TOTAL' } : { tipo: 'SUBARVORE', raiz: '4.3', ccs: new Set(['4.3.2']) },
    arvore: [{ cc: '4', descricao: 'DIREX', total: d('1000000.00'), filhos: [{ cc: '4.3.2', descricao: 'Gerência Financeira', total: d('321098.76'), filhos: [] }] }],
    indicadores: { orcamentoAno: d('1000000.00'), pessoal: d('600000.00') },
  }) as unknown as VisaoExercicio;
let escopoTotal = true;
const falso = criarProvedorIAFalso();
const deps = () => ({
  ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }),
  agora: () => new Date('2027-05-20T12:00:00Z'),
  lerVisao: async (_c: ContextoRequisicao, ano: number) => (ano === 2027 ? visao(escopoTotal) : null),
  lerTps: async () => [{ numero: 'TP-001/2027', oficial: true, valorGlobal: '50000.00' }],
});
const classificar = (consulta: string, extra: { ano?: number | null; cc?: string | null; tp?: string | null } = {}) =>
  (falso.roteiro.estruturado = { consulta, ano: null, cc: null, tp: null, ...extra });
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
    const r = await perguntarAoSgo(ctx(), { pergunta: 'Qual o orçamento da Adm. Central em 2027?' }, deps());
    expect(r).toMatchObject({ ok: true, valor: { tipo: 'NUMERO', valor: '1000000.00', link: '/orc/orcamento?ano=2027', fonte: expect.stringContaining('exercício 2027') } });
    const m = falso.chamadas.at(-1)!.mensagem;
    expect(m).toContain('Pergunta: <<<Qual o orçamento da Adm. Central em 2027?>>>');
    expect(m).not.toContain('1000000');
  });

  it('CC e TP: acha pela classificação; fora do acesso, diz que não está; TP sem diferença de escrita', async () => {
    classificar('ORCADO_CC', { ano: 2027, cc: '4.3.2' });
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Quanto orçou o CC 4.3.2?' }, deps())).toMatchObject({ ok: true, valor: { valor: '321098.76', link: '/orc/orcamento?ano=2027&cc=4.3.2' } });
    classificar('ORCADO_CC', { ano: 2027, cc: '4.9' });
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Quanto orçou o CC 4.9?' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.CC_FORA('4.9') } });
    classificar('VALOR_GLOBAL_TP', { tp: 'tp 001/2027' });
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Valor global do tp 001/2027' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'NUMERO', valor: '50000.00', link: '/orc/consolidado' } });
  });

  it('permissões e escopo de quem pergunta valem: sem o orçamento ou o consolidado, sem número; com escopo, sem teto e com "do seu escopo"', async () => {
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx([IA, CONS]), { pergunta: 'Qual o orçamento de 2027?' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_ACESSO_ORCAMENTO } });
    classificar('QUANTIDADE_TPS');
    expect(await perguntarAoSgo(ctx([IA, ORC]), { pergunta: 'Quantos TPs existem?' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_ACESSO_CONSOLIDADO } });
    escopoTotal = false;
    classificar('TETO_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Qual o teto de 2027?' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SO_INTEIRA } });
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 2027 });
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Qual o orçamento de 2027?' }, deps())).toMatchObject({ ok: true, valor: { texto: expect.stringContaining('(do seu escopo)') } });
  });

  it('fora do catálogo, ano sem exercício, caso desligado e sem permissão do caso', async () => {
    classificar('LISTAR_SALARIOS');
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Qual o salário do Fulano?' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'NAO_SEI' } });
    classificar('ORCAMENTO_ADM_CENTRAL', { ano: 2030 });
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Qual o orçamento de 2030?' }, deps())).toMatchObject({ ok: true, valor: { tipo: 'SEM_DADO', texto: MENSAGENS_PERGUNTE.SEM_EXERCICIO(2030) } });
    expect(await perguntarAoSgo(ctx([ORC]), { pergunta: 'Qual o orçamento?' }, deps())).toMatchObject({ ok: false });
    await ligarCaso(false);
    expect(await pergunteLiberado(ctx(), deps())).toBe(false);
    expect(await perguntarAoSgo(ctx(), { pergunta: 'Qual o orçamento?' }, deps())).toMatchObject({ ok: false });
  });
});
