import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../tests/integracao/banco';
import { criarProvedorIAFalso } from './falso';
import { criarServicoIA, instalarCasosUsoIA, limparTextosIA, SISTEMA_IA, type DefinicaoCasoUsoIA, type QuemPedeIA } from './governanca';
import { ErroIA, type EventoStreamIA, type ProvedorIA } from './porta';

// Governança da IA (US-019, spec §4.4) num Postgres real (Testcontainers, D12): tudo nasce
// desligado; a permissão, as chaves, o limite por minuto e o teto mensal recusam antes do provedor;
// cada chamada que chega ao provedor fica no registro append-only, com o custo estimado.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
const usuarios: string[] = [];

const CASO: DefinicaoCasoUsoIA = {
  codigo: 'rel.teste_ia',
  nome: 'Teste da governança',
  funcionalidade: 'rel.teste_ia',
  versaoInstrucao: 2,
  instrucaoSistema: 'Você responde testes.',
};
const COM_TEXTO: DefinicaoCasoUsoIA = { ...CASO, codigo: 'rel.teste_ia_texto', nome: 'Com texto', guardarTexto: true };
const TETO: DefinicaoCasoUsoIA = { ...CASO, codigo: 'rel.teste_ia_teto', nome: 'Teto' };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: a permissão sai daqui.
const PERMISSAO = [CASO.funcionalidade, 'executar'].join(':');
const pessoa = (i: number, permissoes: string[] = [PERMISSAO]): QuemPedeIA => ({ usuarioId: usuarios[i]!, unidadeId: null, permissoes: new Set(permissoes) });

const falso = criarProvedorIAFalso({ texto: 'Sugestão de teste.' });
const servico = (provedor: ProvedorIA = falso) => criarServicoIA({ cliente: app, obterProvedor: () => provedor });

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem erro';
  } catch (e) {
    if (e instanceof ErroIA) return e.codigo;
    throw e;
  }
}

async function chamadas(caso: string): Promise<Record<string, unknown>[]> {
  return (await migrator.query(`SELECT * FROM ia_chamada WHERE caso_uso_codigo = $1 ORDER BY criado_em`, [caso])).rows;
}

async function ligar(sql: string, params: unknown[] = []): Promise<void> {
  await migrator.query(sql, params);
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  await executarSeeds(m, [seedAdm]);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  // A funcionalidade do caso, fora do menu, só com a ação executar (a do caso real vem da seed do módulo).
  await migrator.query(
    `INSERT INTO funcionalidade (codigo, modulo_codigo, grupo, nome, rota, ordem, acoes, exibir_no_menu)
     VALUES ('rel.teste_ia', 'RELATORIOS', 'Testes', 'Teste da IA', '/rel/teste-ia', 99, ARRAY['executar'], false)`,
  );
  await executarSeeds(m, [{ nome: 'ia-teste', executar: (tx) => instalarCasosUsoIA(tx, [CASO, COM_TEXTO, TETO]) }]);
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  for (const login of ['ana', 'bia', 'caio', 'davi']) {
    const { rows } = await migrator.query(
      `INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ($1, $2, $1, $1, 'x') RETURNING id`,
      [login, `${login}@exemplo.org`],
    );
    usuarios.push(rows[0].id);
  }
}, 120_000);

afterAll(async () => {
  await app?.$disconnect();
  await migrator?.end();
  await banco?.parar();
});

describe('tudo desligado por padrão', () => {
  it('a chave geral nasce desligada, e o caso instalado nasce inativo e com teto zero', async () => {
    expect(await app.iaConfiguracao.findUnique({ where: { id: 1 } })).toMatchObject({ habilitada: false });
    const caso = await app.iaCasoUso.findUnique({ where: { codigo: CASO.codigo } });
    expect(caso).toMatchObject({ ativo: false, versaoInstrucao: 2, modelo: 'claude-opus-5-5', esforco: 'medium', guardarTexto: false });
    expect(caso!.tetoMensalUsd.isZero()).toBe(true);
  });

  it('desligada: ia.desligada, sem chamar o provedor nem registrar', async () => {
    const antes = falso.chamadas.length;
    expect(await codigo(servico().gerarTexto(pessoa(0), CASO, 'oi'))).toBe('ia.desligada');
    expect(falso.chamadas.length).toBe(antes);
    expect(await chamadas(CASO.codigo)).toHaveLength(0);
  });

  it('cada trava sozinha mantém desligada: chave geral, caso inativo, teto global zero, teto do caso zero', async () => {
    const casos: [string, string][] = [
      ['UPDATE ia_configuracao SET habilitada = false, teto_mensal_usd = 100', `UPDATE ia_caso_uso SET ativo = true, teto_mensal_usd = 10 WHERE codigo = '${CASO.codigo}'`],
      ['UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100', `UPDATE ia_caso_uso SET ativo = false, teto_mensal_usd = 10 WHERE codigo = '${CASO.codigo}'`],
      ['UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 0', `UPDATE ia_caso_uso SET ativo = true, teto_mensal_usd = 10 WHERE codigo = '${CASO.codigo}'`],
      ['UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 100', `UPDATE ia_caso_uso SET ativo = true, teto_mensal_usd = 0 WHERE codigo = '${CASO.codigo}'`],
    ];
    for (const [config, caso] of casos) {
      await ligar(config);
      await ligar(caso);
      expect(await codigo(servico().gerarTexto(pessoa(0), CASO, 'oi')), `${config} / ${caso}`).toBe('ia.desligada');
    }
  });
});

describe('ligada', () => {
  beforeAll(async () => {
    await ligar('UPDATE ia_configuracao SET habilitada = true, teto_mensal_usd = 1000, limite_por_minuto = 3');
    await ligar(`UPDATE ia_caso_uso SET ativo = true, teto_mensal_usd = 100 WHERE codigo IN ($1, $2)`, [CASO.codigo, COM_TEXTO.codigo]);
  });

  it('sem a permissão do caso: ia.sem_permissao, antes de olhar o banco', async () => {
    expect(await codigo(servico().gerarTexto(pessoa(1, ['rel.teste_ia:consultar']), CASO, 'oi'))).toBe('ia.sem_permissao');
  });

  it('a chamada usa a configuração do cadastro e fica no registro, com custo e hash, sem o texto', async () => {
    await ligar(`UPDATE ia_caso_uso SET esforco = 'low', max_tokens = 500 WHERE codigo = $1`, [CASO.codigo]);
    const r = await servico().gerarTexto(pessoa(1), CASO, 'Material de escritório');
    expect(r.valor).toBe('Sugestão de teste.');
    expect(falso.chamadas.at(-1)).toMatchObject({ instrucaoSistema: CASO.instrucaoSistema, modelo: 'claude-opus-5-5', esforco: 'low', maxTokens: 500 });
    const [linha] = await chamadas(CASO.codigo);
    expect(linha).toMatchObject({ usuario_id: usuarios[1], versao_instrucao: 2, modelo: 'claude-opus-5-5', modelo_resposta: 'claude-opus-5-5', motivo_parada: 'end_turn', erro: null });
    // Falso: entrada = 21 + 22 caracteres, saída = 20 ("Sugestão de teste." em JSON); 43 × 400 + 20 × 2000 = 57.200 unidades de 1e-8.
    expect(linha!.custo_estimado_usd).toBe('0.00057200');
    expect(linha!.hash_entrada).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(linha)).not.toContain('escritório');
    expect((await migrator.query('SELECT count(*)::int AS n FROM ia_chamada_texto')).rows[0].n).toBe(0);
  });

  it('estruturado e erro do provedor: o erro também fica no registro', async () => {
    const s = servico(criarProvedorIAFalso({ estruturado: { conta: 1 } }));
    expect(await codigo(s.gerarEstruturado(pessoa(2), CASO, 'x', z.object({ conta: z.string() })))).toBe('ia.saida_invalida');
    const ultima = (await chamadas(CASO.codigo)).at(-1);
    expect(ultima).toMatchObject({ usuario_id: usuarios[2], erro: 'ia.saida_invalida', custo_estimado_usd: '0.00000000' });
  });

  it('o erro com uso (recusa, corte) registra os tokens gastos', async () => {
    const recusa: ProvedorIA = {
      ...falso,
      gerarTexto: async () => {
        throw new ErroIA('ia.recusa', { uso: { entrada: 100, saida: 10, cacheLeitura: 0, cacheEscrita: 0 }, modelo: 'claude-opus-5' });
      },
    };
    expect(await codigo(servico(recusa).gerarTexto(SISTEMA_IA, CASO, 'x'))).toBe('ia.recusa');
    expect((await chamadas(CASO.codigo)).at(-1)).toMatchObject({ usuario_id: null, erro: 'ia.recusa', modelo_resposta: 'claude-opus-5', custo_estimado_usd: '0.00075000' });
  });

  it('stream: registra no fim; parar no meio conta como cancelada', async () => {
    const s = servico(criarProvedorIAFalso({ texto: 'abcdefghij', pedaco: 2 }));
    const eventos: EventoStreamIA[] = [];
    for await (const e of s.gerarStream(pessoa(2), CASO, 'stream')) eventos.push(e);
    expect(eventos.at(-1)?.tipo).toBe('fim');
    expect((await chamadas(CASO.codigo)).at(-1)).toMatchObject({ erro: null, motivo_parada: 'end_turn' });
    for await (const e of s.gerarStream(pessoa(2), CASO, 'stream')) if (e.tipo === 'texto') break;
    expect((await chamadas(CASO.codigo)).at(-1)).toMatchObject({ erro: 'ia.cancelada', custo_estimado_usd: '0.00000000' });
  });

  it('limite por minuto da pessoa: ia.limite_usuario, temporário; outra pessoa segue', async () => {
    const s = servico();
    for (let i = 0; i < 3; i++) await s.gerarTexto(pessoa(3), CASO, `n${i}`);
    const e = await s.gerarTexto(pessoa(3), CASO, 'n3').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroIA);
    expect([(e as ErroIA).codigo, (e as ErroIA).temporario]).toEqual(['ia.limite_usuario', true]);
    await expect(s.gerarTexto(pessoa(0), CASO, 'outra')).resolves.toBeTruthy();
    // O Sistema (worker) não tem limite por minuto.
    await expect(s.gerarTexto(SISTEMA_IA, CASO, 'sistema')).resolves.toBeTruthy();
  });

  it('guardarTexto: entrada e saída em ia_chamada_texto; a retenção apaga só o texto com mais de 90 dias', async () => {
    await servico().gerarTexto(SISTEMA_IA, COM_TEXTO, 'Texto completo');
    const [linha] = await chamadas(COM_TEXTO.codigo);
    const { rows } = await migrator.query('SELECT entrada, saida FROM ia_chamada_texto WHERE chamada_id = $1', [linha!.id]);
    expect(rows).toEqual([{ entrada: 'Texto completo', saida: 'Sugestão de teste.' }]);
    expect(await limparTextosIA(app, new Date(Date.now() + 89 * 86_400_000))).toBe(0);
    expect(await limparTextosIA(app, new Date(Date.now() + 91 * 86_400_000))).toBe(1);
    expect(await chamadas(COM_TEXTO.codigo)).toHaveLength(1);
  });
});

describe('teto mensal', () => {
  const caro: ProvedorIA = {
    ...falso,
    gerarTexto: async (p) => ({ ...(await falso.gerarTexto(p)), uso: { entrada: 0, saida: 1_000_000, cacheLeitura: 0, cacheEscrita: 0 } }),
  };

  it('do caso: a chamada que passa do teto entra; a seguinte é recusada com aviso, e os outros casos seguem', async () => {
    await ligar(`UPDATE ia_caso_uso SET ativo = true, teto_mensal_usd = 30 WHERE codigo = $1`, [TETO.codigo]);
    // O gasto do mês anterior não conta (custo alto em outubro).
    await ligar(
      `INSERT INTO ia_chamada (caso_uso_codigo, versao_instrucao, modelo, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo_estimado_usd, latencia_ms, hash_entrada, criado_em)
       VALUES ($1, 1, 'claude-opus-5-5', 0, 0, 0, 0, 500, 0, repeat('a', 64), date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' - interval '1 second')`,
      [TETO.codigo],
    );
    const s = servico(caro);
    await s.gerarTexto(SISTEMA_IA, TETO, 'um'); // US$ 20
    await s.gerarTexto(SISTEMA_IA, TETO, 'dois'); // US$ 40: passou de 30
    expect(await codigo(s.gerarTexto(SISTEMA_IA, TETO, 'três'))).toBe('ia.teto_atingido');
    await expect(s.gerarTexto(SISTEMA_IA, CASO, 'outro caso')).resolves.toBeTruthy();
  });

  it('global: a soma de todos os casos no mês desliga todos', async () => {
    const { rows } = await migrator.query(
      `SELECT sum(custo_estimado_usd) AS s FROM ia_chamada WHERE criado_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
    );
    await ligar('UPDATE ia_configuracao SET teto_mensal_usd = floor($1::numeric)', [rows[0].s]);
    expect(await codigo(servico().gerarTexto(SISTEMA_IA, CASO, 'x'))).toBe('ia.teto_atingido');
    expect(await codigo(servico().gerarTexto(SISTEMA_IA, COM_TEXTO, 'x'))).toBe('ia.teto_atingido');
    await ligar('UPDATE ia_configuracao SET teto_mensal_usd = 1000');
  });
});

describe('banco', () => {
  it('ia_chamada é somente inserção, para qualquer papel', async () => {
    await expect(migrator.query(`UPDATE ia_chamada SET erro = 'ia.recusa'`)).rejects.toThrow(/somente inserção/);
    await expect(migrator.query('DELETE FROM ia_chamada')).rejects.toThrow(/somente inserção/);
    await expect(migrator.query('TRUNCATE ia_chamada CASCADE')).rejects.toThrow(/somente inserção/);
  });

  it('o app altera só a configuração; não instala caso, não reescreve o código do caso nem forja id ou data', async () => {
    await expect(app.iaConfiguracao.update({ where: { id: 1 }, data: { limitePorMinuto: 5, alteradoEm: new Date() } })).resolves.toBeTruthy();
    await expect(app.iaCasoUso.update({ where: { codigo: CASO.codigo }, data: { maxTokens: 1000, modelo: 'claude-opus-5' } })).resolves.toBeTruthy();
    await expect(app.iaCasoUso.update({ where: { codigo: CASO.codigo }, data: { versaoInstrucao: 9 } })).rejects.toThrow();
    await expect(app.iaCasoUso.create({ data: { codigo: 'rel.forjado', nome: 'x', funcionalidade: 'rel.teste_ia', versaoInstrucao: 1 } })).rejects.toThrow();
    await expect(
      app.iaChamada.create({
        data: {
          criadoEm: new Date('2020-01-01'),
          casoUsoCodigo: CASO.codigo,
          versaoInstrucao: 1,
          modelo: 'm',
          tokensEntrada: 0,
          tokensSaida: 0,
          tokensCacheLeitura: 0,
          tokensCacheEscrita: 0,
          custoEstimadoUsd: '0',
          latenciaMs: 0,
          hashEntrada: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow();
  });

  it('os CHECKs recusam esforço desconhecido, configuração fora da faixa e segunda linha de configuração', async () => {
    await expect(migrator.query(`UPDATE ia_caso_uso SET esforco = 'turbo' WHERE codigo = $1`, [CASO.codigo])).rejects.toThrow(/check/);
    await expect(migrator.query('UPDATE ia_configuracao SET limite_por_minuto = 0')).rejects.toThrow(/check/);
    await expect(migrator.query('INSERT INTO ia_configuracao (id) VALUES (2)')).rejects.toThrow(/check/);
  });

  it('instalar de novo atualiza o que vem do código e preserva a configuração da tela', async () => {
    const m = criarPrisma(banco.urlMigrator);
    await executarSeeds(m, [{ nome: 'ia-teste-2', executar: (tx) => instalarCasosUsoIA(tx, [{ ...CASO, nome: 'Novo nome', versaoInstrucao: 3 }]) }]);
    const sem = { ...CASO, codigo: 'rel.sem_executar', funcionalidade: 'adm.usuarios' };
    await expect(executarSeeds(m, [{ nome: 'ia-teste-3', executar: (tx) => instalarCasosUsoIA(tx, [sem]) }])).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/não tem a ação "executar"/) }),
    });
    await m.$disconnect();
    expect(await app.iaCasoUso.findUnique({ where: { codigo: CASO.codigo } })).toMatchObject({ nome: 'Novo nome', versaoInstrucao: 3, ativo: true, maxTokens: 1000 });
  });
});
