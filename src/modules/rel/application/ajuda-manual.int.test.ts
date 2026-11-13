import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { criarProvedorIAFalso, criarServicoIA } from '@/shared/ia';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { ajudaManualLiberada, MENSAGENS_AJUDA, perguntarAoManual } from './ajuda-manual';
import { CASO_AJUDA_MANUAL } from './ia-casos';

// Ajuda "como faço..." com base no manual (US-108) num Postgres real (Testcontainers, D12): a
// governança da IA (US-019) com o provedor falso. O manual é o do perfil: o catálogo do adm e do rel,
// filtrado pelas permissões de quem pergunta.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: PrismaClient;
let app: PrismaClient;
let usuarioId = '';
// O caso como a seed instalou, antes de os testes o ligarem.
let casoInicial: { ativo: boolean; teto: boolean } = { ativo: true, teto: false };

// "funcionalidade:ação" literal parece credencial para o GitGuardian: as permissões saem daqui.
const perm = (f: string, a: string) => [f, a].join(':');
const IA = perm(CASO_AJUDA_MANUAL.funcionalidade, 'executar');
const EXPORTACOES = perm('rel.exportacoes', 'consultar');
const CONFERENCIA = perm('rel.conferencia_carga', 'consultar');
// Dados de quem pergunta: nunca podem ir para a IA.
const PESSOA = { nome: 'Fulana Teste de Souza', login: 'fulana.souza', email: 'fulana.souza@exemplo.org' };

const ctx = (permissoes: string[] = [IA, EXPORTACOES]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: PESSOA.login,
  sessaoUid: 's1',
  ip: null,
  unidadeId: null,
  permissoes: new Set(permissoes),
});

const falso = criarProvedorIAFalso();
const deps = () => ({ cliente: app, ia: criarServicoIA({ cliente: app, obterProvedor: () => falso }) });
const RESPOSTA = { encontrou: true, resposta: 'Abra Relatórios › Arquivos › Minhas exportações e baixe o arquivo pronto.', trechos: ['T1'] };

const contar = async (sql: string) => (await migrator.$queryRawUnsafe<{ n: number }[]>(sql))[0]!.n;
const chamadas = () => contar(`SELECT count(*)::int AS n FROM ia_chamada WHERE caso_uso_codigo = '${CASO_AJUDA_MANUAL.codigo}'`);
const ligarCaso = (ativo: boolean) => migrator.$executeRawUnsafe(`UPDATE ia_caso_uso SET ativo = $1, teto_mensal_usd = 10 WHERE codigo = $2`, ativo, CASO_AJUDA_MANUAL.codigo);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  await executarSeeds(migrator, [seedAdm, seedRel]);
  const c = await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_AJUDA_MANUAL.codigo } });
  casoInicial = { ativo: c.ativo, teto: c.tetoMensalUsd.isZero() };
  app = criarPrisma(banco.urlApp);
  usuarioId = (await migrator.usuario.create({ data: { ...PESSOA, loginNormalizado: PESSOA.login, senhaHash: 'x' } })).id;
  await migrator.$executeRawUnsafe(`UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100, limite_por_minuto = 100`);
}, 180_000);

beforeEach(async () => {
  falso.roteiro.estruturado = RESPOSTA;
  delete falso.roteiro.erro;
  await ligarCaso(true);
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('seed da ajuda do manual', () => {
  it('o caso nasce desligado e com teto zero; a permissão é de todos os perfis e fica fora do menu e do manual', async () => {
    const caso = await migrator.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO_AJUDA_MANUAL.codigo } });
    expect(caso.funcionalidade).toBe(CASO_AJUDA_MANUAL.funcionalidade);
    const f = await migrator.funcionalidade.findUniqueOrThrow({ where: { codigo: CASO_AJUDA_MANUAL.funcionalidade } });
    expect(f.exibirNoMenu).toBe(false);
    const perfis = await migrator.perfilPermissao.findMany({ where: { funcionalidadeCodigo: CASO_AJUDA_MANUAL.funcionalidade, acao: 'executar' } });
    expect(new Set(perfis.map((p) => p.perfilId)).size).toBe(8);
    expect(casoInicial).toEqual({ ativo: false, teto: true });
  });
});

describe('ajudaManualLiberada', () => {
  it('o campo aparece só com a permissão do caso e o caso ligado', async () => {
    expect(await ajudaManualLiberada(ctx(), deps())).toBe(true);
    expect(await ajudaManualLiberada(ctx([EXPORTACOES]), deps())).toBe(false);
    await ligarCaso(false);
    expect(await ajudaManualLiberada(ctx(), deps())).toBe(false);
  });
});

describe('perguntarAoManual', () => {
  it('responde com o trecho do manual do perfil; a mensagem leva só o manual e a pergunta; nada gravado além do registro', async () => {
    const antes = { chamadas: await chamadas(), historico: await contar('SELECT count(*)::int AS n FROM historico_operacao') };
    const r = await perguntarAoManual(ctx(), { pergunta: 'Como faço para baixar uma exportação?' }, deps());
    expect(r).toEqual({
      ok: true,
      valor: {
        encontrou: true,
        resposta: RESPOSTA.resposta,
        trechos: [expect.objectContaining({ id: 'T1', nome: 'Minhas exportações', rota: '/rel/exportacoes', local: 'Relatórios › Arquivos' })],
      },
    });
    expect(await chamadas()).toBe(antes.chamadas + 1);
    expect(await contar('SELECT count(*)::int AS n FROM historico_operacao')).toBe(antes.historico);
    const pedido = falso.chamadas.at(-1)!;
    expect(pedido.instrucaoSistema).toBe(CASO_AJUDA_MANUAL.instrucaoSistema);
    expect(pedido.mensagem).toContain('[T1] Relatórios › Arquivos › Minhas exportações');
    expect(pedido.mensagem).toContain('<<<Como faço para baixar uma exportação?>>>');
    // Só o manual do perfil: a conferência da carga não está nas permissões desta pessoa.
    expect(pedido.mensagem).not.toContain('Conferência da carga');
    for (const dado of [PESSOA.nome, PESSOA.login, PESSOA.email, usuarioId]) expect(pedido.mensagem).not.toContain(dado);
  });

  it('trecho que não existe no manual do perfil: "não encontrou", sem a resposta inventada', async () => {
    falso.roteiro.estruturado = { encontrou: true, resposta: 'Use a Conferência da carga.', trechos: ['T2'] };
    expect(await perguntarAoManual(ctx(), { pergunta: 'Como confiro a carga?' }, deps())).toEqual({ ok: true, valor: { encontrou: false } });
    // Com a permissão, o mesmo T2 passa a existir e é citado.
    const r = await perguntarAoManual(ctx([IA, CONFERENCIA, EXPORTACOES]), { pergunta: 'Como confiro a carga?' }, deps());
    expect(r.ok && r.valor.encontrou && r.valor.trechos.map((t) => t.nome)).toEqual(['Minhas exportações']);
  });

  it('pergunta curta, longa ou só de marcas não chama a IA', async () => {
    const antes = falso.chamadas.length;
    const curta = { ok: false, erros: [{ campo: 'pergunta', mensagem: MENSAGENS_AJUDA.PERGUNTA_CURTA }] };
    expect(await perguntarAoManual(ctx(), { pergunta: '  oi ' }, deps())).toEqual(curta);
    expect(await perguntarAoManual(ctx(), { pergunta: '<<<>>><<<>>>' }, deps())).toEqual(curta);
    expect(await perguntarAoManual(ctx(), {}, deps())).toEqual(curta);
    expect(await perguntarAoManual(ctx(), { pergunta: 'x'.repeat(501) }, deps())).toEqual({ ok: false, erros: [{ campo: 'pergunta', mensagem: MENSAGENS_AJUDA.PERGUNTA_LONGA }] });
    expect(falso.chamadas.length).toBe(antes);
  });

  it('sem a permissão do caso, com o manual vazio ou com a IA desligada: a mensagem certa, sem chamar o provedor', async () => {
    const antes = falso.chamadas.length;
    const p = { pergunta: 'Como faço para exportar?' };
    expect(await perguntarAoManual(ctx([EXPORTACOES]), p, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Você não tem permissão para usar a IA nesta função.' }] });
    expect(await perguntarAoManual(ctx([IA]), p, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MENSAGENS_AJUDA.MANUAL_VAZIO }] });
    await ligarCaso(false);
    expect(await perguntarAoManual(ctx(), p, deps())).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'A IA está desligada para esta função.' }] });
    expect(falso.chamadas.length).toBe(antes);
  });

  it('erro do provedor vira a mensagem fixa, e o tempo esgotado tem a dele', async () => {
    falso.roteiro.erro = 'ia.indisponivel';
    expect(await perguntarAoManual(ctx(), { pergunta: 'Como faço para exportar?' }, deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'A IA está indisponível no momento. Tente de novo mais tarde.' }],
    });
    delete falso.roteiro.erro;
    const esgotado = AbortSignal.timeout(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(await perguntarAoManual(ctx(), { pergunta: 'Como faço para exportar?' }, { ...deps(), sinalIa: () => esgotado })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_AJUDA.TEMPO_ESGOTADO }],
    });
  });
});
