import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { instalarCasosUsoIA } from '@/shared/ia';
import { ConflitoConcorrencia } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedInt } from '../infrastructure/seed';
import { alterarCasoUsoIA, alterarConfiguracaoIA, MSG_LIMITE, MSG_MAX_TOKENS, MSG_ORIGEM_BLINDADA, MSG_TETO, obterTelaIA } from './ia';

// Cadastro da IA (US-019 parte 2) num Postgres real (Testcontainers, D12): a tela lê a configuração,
// os casos e o consumo do mês; as alterações conferem a versão e vão ao Histórico.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
const AGORA = () => new Date();

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...acoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'admin',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(acoes.map((a) => ['int.ia', a].join(':'))),
});
const ADMIN = () => ctx('consultar', 'alterar');
const CASO = { codigo: 'rel.teste_ia', nome: 'Teste', funcionalidade: 'rel.teste_ia', versaoInstrucao: 1, instrucaoSistema: 'x' };

async function chamada(custo: string, erro: string | null, criadoEm = 'clock_timestamp()'): Promise<void> {
  await migrator.query(
    `INSERT INTO ia_chamada (caso_uso_codigo, versao_instrucao, modelo, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo_estimado_usd, latencia_ms, erro, hash_entrada, criado_em)
     VALUES ($1, 1, 'claude-opus-5-5', 0, 0, 0, 0, $2, 0, $3, repeat('a', 64), ${criadoEm})`,
    [CASO.codigo, custo, erro],
  );
}

async function historico(): Promise<Record<string, unknown>[]> {
  return (await migrator.query(`SELECT registro_id, descricao, antes, depois FROM historico_operacao WHERE funcionalidade = 'int.ia' ORDER BY id`)).rows;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  await executarSeeds(m, [seedAdm, seedInt]);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  await migrator.query(
    `INSERT INTO funcionalidade (codigo, modulo_codigo, grupo, nome, rota, ordem, acoes, exibir_no_menu)
     VALUES ('rel.teste_ia', 'RELATORIOS', 'Testes', 'Teste da IA', '/rel/teste-ia', 99, ARRAY['executar'], false)`,
  );
  await executarSeeds(m, [{ nome: 'ia-teste', executar: (tx) => instalarCasosUsoIA(tx, [CASO]) }]);
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  usuarioId = (
    await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('admin', 'admin@exemplo.org', 'admin', 'admin', 'x') RETURNING id`)
  ).rows[0].id;
}, 120_000);

afterAll(async () => {
  await app?.$disconnect();
  await migrator?.end();
  await banco?.parar();
});

describe('seed do int', () => {
  it('int.ia no menu Cadastros: Administrador consulta e altera; Auditor só consulta', async () => {
    const { rows } = await migrator.query(
      `SELECT p.codigo, pp.acao FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id WHERE pp.funcionalidade_codigo = 'int.ia' ORDER BY 1, 2`,
    );
    expect(rows).toEqual([
      { codigo: 'ADMINISTRADOR', acao: 'alterar' },
      { codigo: 'ADMINISTRADOR', acao: 'consultar' },
      { codigo: 'AUDITOR', acao: 'consultar' },
    ]);
    expect((await migrator.query(`SELECT modulo_codigo, rota FROM funcionalidade WHERE codigo = 'int.ia'`)).rows[0]).toEqual({ modulo_codigo: 'CADASTROS', rota: '/int/ia' });
  });
});

describe('tela', () => {
  it('sem consultar: ErroPermissao', async () => {
    await expect(obterTelaIA(ctx(), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('nasce desligada, com o caso inativo e sem consumo', async () => {
    const t = await obterTelaIA(ctx('consultar'), { cliente: app });
    expect(t.configuracao).toMatchObject({ habilitada: false, limitePorMinuto: 10, tetoMensalUsd: '0.00', gastoMesUsd: '0.00', chamadasMes: 0, tetoAtingido: false });
    expect(t.casos).toEqual([expect.objectContaining({ codigo: CASO.codigo, ativo: false, modelo: 'claude-opus-5-5', esforco: 'medium', tetoMensalUsd: '0.00' })]);
    expect(t.modelos).toContain('claude-opus-5-5');
    expect(t.mes).toMatch(/^\d{2}\/\d{4}$/);
  });

  it('consumo do mês: soma, chamadas, erros e o teto atingido; o mês anterior não conta', async () => {
    await migrator.query(`UPDATE ia_configuracao SET teto_mensal_usd = 100`);
    await migrator.query(`UPDATE ia_caso_uso SET teto_mensal_usd = 1`);
    await chamada('0.6', null);
    await chamada('0.40000001', 'ia.recusa');
    await chamada('500', null, `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' - interval '1 second'`);
    const t = await obterTelaIA(ctx('consultar'), { cliente: app, agora: AGORA });
    // Arredonda para cima na exibição: 1.00000001 aparece como 1,01.
    expect(t.casos[0]).toMatchObject({ gastoMesUsd: '1.01', chamadasMes: 2, errosMes: 1, tetoAtingido: true });
    expect(t.configuracao).toMatchObject({ gastoMesUsd: '1.01', chamadasMes: 2, errosMes: 1, tetoAtingido: false });
  });

  it('reserva aberta conta no teto, como na governança; vencida (mais de 15 min) não', async () => {
    await migrator.query(`UPDATE ia_caso_uso SET teto_mensal_usd = 2`);
    await migrator.query(`INSERT INTO ia_reserva (caso_uso_codigo, custo_maximo_usd, criado_em) VALUES ($1, 5, clock_timestamp() - interval '20 minutes')`, [CASO.codigo]);
    expect((await obterTelaIA(ctx('consultar'), { cliente: app, agora: AGORA })).casos[0]!.tetoAtingido).toBe(false);
    await migrator.query(`INSERT INTO ia_reserva (caso_uso_codigo, custo_maximo_usd) VALUES ($1, 1)`, [CASO.codigo]);
    expect((await obterTelaIA(ctx('consultar'), { cliente: app, agora: AGORA })).casos[0]!.tetoAtingido).toBe(true);
    await migrator.query('DELETE FROM ia_reserva');
  });
});

describe('alterar a configuração geral', () => {
  it('sem alterar: ErroPermissao', async () => {
    await expect(alterarConfiguracaoIA(ctx('consultar'), { versao: '1', limitePorMinuto: '5', tetoGlobalUsd: '1' }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('valores inválidos: erro por campo, sem gravar', async () => {
    const r = await alterarConfiguracaoIA(ADMIN(), { versao: '1', habilitada: 'sim', limitePorMinuto: '0', tetoGlobalUsd: '-3' }, { cliente: app });
    expect(r).toEqual({
      ok: false,
      erros: [
        { campo: 'limitePorMinuto', mensagem: MSG_LIMITE },
        { campo: 'tetoGlobalUsd', mensagem: MSG_TETO },
      ],
    });
    expect((await app.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } })).habilitada).toBe(false);
  });

  it('campo calculado no pedido (origem blindada): erro de domínio, auditado, sem gravar', async () => {
    await expect(
      alterarConfiguracaoIA(ADMIN(), { versao: '1', limitePorMinuto: '5', tetoGlobalUsd: '1', gastoMesUsd: '0' }, { cliente: app }),
    ).rejects.toMatchObject({ codigo: 'int.violacao_governanca', message: MSG_ORIGEM_BLINDADA });
    expect((await historico()).at(-1)).toMatchObject({ registro_id: 'configuracao', depois: { campos: ['gastoMesUsd'] } });
    const r = await alterarConfiguracaoIA(ADMIN(), { versao: '1', limitePorMinuto: '5', tetoGlobalUsd: '1', outro: 'x' }, { cliente: app });
    expect(r).toEqual({ ok: false, erros: [{ campo: '', mensagem: 'Os dados enviados não são válidos. Recarregue a tela.' }] });
  });

  it('liga a IA, sobe a versão e vai ao Histórico; a versão velha é conflito', async () => {
    const versao = (await app.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } })).versao;
    const r = await alterarConfiguracaoIA(ADMIN(), { versao: String(versao), habilitada: 'sim', limitePorMinuto: '1.000', tetoGlobalUsd: '1.234,5' }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: versao + 1 } });
    expect(await app.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ habilitada: true, limitePorMinuto: 1000, versao: versao + 1 });
    expect((await historico()).at(-1)).toMatchObject({
      registro_id: 'configuracao',
      descricao: 'IA ligada (chave geral)',
      antes: { habilitada: false, limitePorMinuto: 10, tetoMensalUsd: '100.00' },
      depois: { habilitada: true, limitePorMinuto: 1000, tetoMensalUsd: '1234.50' },
    });
    await expect(alterarConfiguracaoIA(ADMIN(), { versao: String(versao), limitePorMinuto: '5', tetoGlobalUsd: '1' }, { cliente: app })).rejects.toBeInstanceOf(
      ConflitoConcorrencia,
    );
  });

  it('desmarcar a caixa desliga', async () => {
    const versao = (await app.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } })).versao;
    await alterarConfiguracaoIA(ADMIN(), { versao: String(versao), limitePorMinuto: '10', tetoGlobalUsd: '100' }, { cliente: app });
    expect((await app.iaConfiguracao.findUniqueOrThrow({ where: { id: 1 } })).habilitada).toBe(false);
    expect((await historico()).at(-1)).toMatchObject({ descricao: 'IA desligada (chave geral)' });
  });
});

describe('alterar um caso de uso', () => {
  const base = { codigo: CASO.codigo, modelo: 'claude-opus-5', esforco: 'high', maxTokens: '8.000', tetoMensalUsd: '25' };

  it('liga o caso com outro modelo e esforço; vai ao Histórico', async () => {
    const r = await alterarCasoUsoIA(ADMIN(), { ...base, versao: '1', ativo: 'sim' }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { versao: 2 } });
    expect(await app.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO.codigo } })).toMatchObject({ ativo: true, modelo: 'claude-opus-5', esforco: 'high', maxTokens: 8000, versao: 2 });
    expect((await historico()).at(-1)).toMatchObject({ registro_id: CASO.codigo, descricao: `Caso de uso de IA ${CASO.codigo} ligado` });
  });

  it('modelo fora da lista, esforço desconhecido e tamanho fora da faixa: erro por campo', async () => {
    const r = await alterarCasoUsoIA(ADMIN(), { ...base, versao: '2', modelo: 'gpt', esforco: 'turbo', maxTokens: '200000', tetoMensalUsd: 'x' }, { cliente: app });
    expect(r.ok ? [] : r.erros.map((e) => e.campo)).toEqual(['modelo', 'esforco', 'maxTokens', 'tetoMensalUsd']);
    expect(r.ok ? null : r.erros.find((e) => e.campo === 'maxTokens')?.mensagem).toBe(MSG_MAX_TOKENS);
  });

  it('nome, permissão ou guardarTexto no pedido (vêm do código): auditado e recusado', async () => {
    await expect(alterarCasoUsoIA(ADMIN(), { ...base, versao: '2', guardarTexto: 'sim', funcionalidade: 'adm.usuarios' }, { cliente: app })).rejects.toMatchObject({
      codigo: 'int.violacao_governanca',
    });
    expect((await historico()).at(-1)).toMatchObject({ registro_id: CASO.codigo, depois: { campos: ['funcionalidade', 'guardarTexto'] } });
    expect((await app.iaCasoUso.findUniqueOrThrow({ where: { codigo: CASO.codigo } })).versao).toBe(2);
  });

  it('versão velha: conflito; caso inexistente: erro geral', async () => {
    await expect(alterarCasoUsoIA(ADMIN(), { ...base, versao: '1' }, { cliente: app })).rejects.toBeInstanceOf(ConflitoConcorrencia);
    const r = await alterarCasoUsoIA(ADMIN(), { ...base, codigo: 'rel.nao_existe', versao: '1' }, { cliente: app });
    expect(r.ok).toBe(false);
  });
});
