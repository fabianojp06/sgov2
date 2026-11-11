import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { ErroIA, instalarCasosUsoIA, type AvaliadorCasoIA, type DefinicaoCasoUsoIA } from '@/shared/ia';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedInt } from '../infrastructure/seed';
import { criarTrabalhadorAvaliacao, MSG_FALHA_AVALIACAO, MSG_SEM_AVALIADOR } from '../infrastructure/trabalhador-avaliacao';
import { MSG_AVALIACAO_EM_CURSO, MSG_AVALIACAO_VENCIDA, MSG_NAO_AVALIAVEL, MSG_SEM_PERMISSAO_CASO, obterTelaIA, pedirAvaliacaoIA } from './ia';

// Avaliação de qualidade da IA (fila ia.avaliar; pedido da frente A na #138) num Postgres real: o
// pedido pela tela (com outbox e Histórico na mesma transação, uma pendente por caso) e o trabalhador
// que roda o avaliador do módulo dono e grava o resultado.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;

const ctx = (acoes: string[], extras: string[] = []): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'admin',
  sessaoUid: 's',
  ip: null,
  permissoes: new Set([...acoes.map((a) => ['int.ia', a].join(':')), ...extras]),
});
const EXECUTAR = ['rel.teste_aval', 'rel.teste_sem_aval', 'rel.teste_aval_b', 'rel.teste_aval_c'].map((f) => [f, 'executar'].join(':'));
const ADMIN = () => ctx(['consultar', 'alterar'], EXECUTAR);
const caso = (codigo: string, avaliavel: boolean): DefinicaoCasoUsoIA => ({ codigo, nome: codigo, funcionalidade: codigo, versaoInstrucao: 1, instrucaoSistema: 'x', avaliavel });
const AVALIAVEL = caso('rel.teste_aval', true);
const SEM_AVAL = caso('rel.teste_sem_aval', false);
const OUTRO = caso('rel.teste_aval_b', true);
const VENCIDO = caso('rel.teste_aval_c', true);

async function pedir(codigo: string): Promise<string> {
  const r = await pedirAvaliacaoIA(ADMIN(), { codigo }, { cliente: app });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor.avaliacaoId;
}
const linha = async (id: string) => (await migrator.query('SELECT situacao, total, acertos, resumo, erro, concluido_em FROM ia_avaliacao WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  await executarSeeds(m, [seedAdm, seedInt]);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  for (const [i, c] of [AVALIAVEL, SEM_AVAL, OUTRO, VENCIDO].entries()) {
    await migrator.query(
      `INSERT INTO funcionalidade (codigo, modulo_codigo, grupo, nome, rota, ordem, acoes, exibir_no_menu) VALUES ($1, 'RELATORIOS', 'Testes', $1, '/rel/x', $2, ARRAY['executar'], false)`,
      [c.codigo, 90 + i],
    );
  }
  await executarSeeds(m, [{ nome: 'ia-aval', executar: (tx) => instalarCasosUsoIA(tx, [AVALIAVEL, SEM_AVAL, OUTRO, VENCIDO]) }]);
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  usuarioId = (await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('a', 'a@exemplo.org', 'a', 'a', 'x') RETURNING id`)).rows[0].id;
}, 120_000);

afterAll(async () => {
  await app?.$disconnect();
  await migrator?.end();
  await banco?.parar();
});

describe('pedirAvaliacaoIA', () => {
  it('sem alterar: ErroPermissao', async () => {
    await expect(pedirAvaliacaoIA(ctx(['consultar']), { codigo: AVALIAVEL.codigo }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('sem a permissão executar do caso (a avaliação roda como quem pede): recusado', async () => {
    expect(await pedirAvaliacaoIA(ctx(['consultar', 'alterar']), { codigo: AVALIAVEL.codigo }, { cliente: app })).toEqual({
      ok: false,
      erros: [{ campo: '', mensagem: MSG_SEM_PERMISSAO_CASO }],
    });
  });

  it('caso sem avaliador: recusado', async () => {
    expect(await pedirAvaliacaoIA(ADMIN(), { codigo: SEM_AVAL.codigo }, { cliente: app })).toEqual({ ok: false, erros: [{ campo: '', mensagem: MSG_NAO_AVALIAVEL }] });
  });

  it('pedido: pendente, outbox ia.avaliar e Histórico na mesma transação; a segunda espera a primeira', async () => {
    const id = await pedir(AVALIAVEL.codigo);
    expect(await linha(id)).toMatchObject({ situacao: 'PENDENTE', total: null, erro: null });
    const { rows } = await migrator.query(`SELECT tipo, dados FROM outbox_mensagem WHERE tipo = 'ia.avaliar'`);
    expect(rows).toEqual([{ tipo: 'ia.avaliar', dados: { avaliacaoId: id } }]);
    const h = await migrator.query(`SELECT tipo_operacao, registro_id FROM historico_operacao WHERE funcionalidade = 'int.ia' ORDER BY id DESC LIMIT 1`);
    expect(h.rows[0]).toEqual({ tipo_operacao: 'INSERCAO', registro_id: id });
    expect(await pedirAvaliacaoIA(ADMIN(), { codigo: AVALIAVEL.codigo }, { cliente: app })).toEqual({ ok: false, erros: [{ campo: '', mensagem: MSG_AVALIACAO_EM_CURSO }] });
    // A tela mostra o botão só nos avaliáveis e a avaliação em andamento.
    const t = await obterTelaIA(ctx(['consultar']), { cliente: app });
    expect(t.casos.find((c) => c.codigo === AVALIAVEL.codigo)).toMatchObject({ avaliavel: true, ultimaAvaliacao: { situacao: 'PENDENTE' } });
    expect(t.casos.find((c) => c.codigo === SEM_AVAL.codigo)).toMatchObject({ avaliavel: false, ultimaAvaliacao: null });
  });
});

describe('trabalhador da fila ia.avaliar', () => {
  it('roda o avaliador do caso como quem pediu e grava o resultado; job repetido não refaz', async () => {
    const [{ id }] = (await migrator.query(`SELECT id FROM ia_avaliacao WHERE caso_uso_codigo = $1 AND situacao = 'PENDENTE'`, [AVALIAVEL.codigo])).rows;
    const recebidos: { avaliacaoId: string; casoUsoCodigo: string; usuarioId: string; sinal: AbortSignal }[] = [];
    const avaliador: AvaliadorCasoIA = async (p) => {
      recebidos.push(p);
      await new Promise((r) => setTimeout(r, 50));
      return { total: 10, acertos: 7, resumo: { porConta: { '4.1.1.5': 3 } } };
    };
    const tratar = criarTrabalhadorAvaliacao({ cliente: app, avaliadores: { [AVALIAVEL.codigo]: avaliador } });
    // Dois workers ao mesmo tempo (reenvio do pg-boss): só um toma a avaliação; depois, o repetido não faz nada.
    await Promise.all([tratar({ avaliacaoId: id }), tratar({ avaliacaoId: id })]);
    await tratar({ avaliacaoId: id });
    await tratar({ avaliacaoId: 'não é uuid' });
    expect(recebidos.map((r) => ({ avaliacaoId: r.avaliacaoId, casoUsoCodigo: r.casoUsoCodigo, usuarioId: r.usuarioId }))).toEqual([{ avaliacaoId: id, casoUsoCodigo: AVALIAVEL.codigo, usuarioId }]);
    expect(recebidos[0]!.sinal).toBeInstanceOf(AbortSignal);
    expect(await linha(id)).toMatchObject({ situacao: 'CONCLUIDA', total: 10, acertos: 7, resumo: { porConta: { '4.1.1.5': 3 } }, erro: null });
    const t = await obterTelaIA(ctx(['consultar']), { cliente: app });
    expect(t.casos.find((c) => c.codigo === AVALIAVEL.codigo)?.ultimaAvaliacao).toMatchObject({ situacao: 'CONCLUIDA', total: 10, acertos: 7 });
  });

  it('sem avaliador registrado, erro da IA, outra falha e resultado inválido: falha com motivo de tela', async () => {
    const casos: [AvaliadorCasoIA | undefined, string][] = [
      [undefined, MSG_SEM_AVALIADOR],
      [async () => Promise.reject(new ErroIA('ia.desligada')), 'A IA está desligada para esta função.'],
      [async () => Promise.reject(new Error('texto do usuário')), MSG_FALHA_AVALIACAO],
      [async () => ({ total: 3, acertos: 4 }), 'O avaliador devolveu um resultado inválido.'],
      // Resumo com texto (LGPD): recusado.
      [async () => ({ total: 3, acertos: 2, resumo: { exemplo: 'texto do usuário' } as never }), 'O avaliador devolveu um resultado inválido.'],
    ];
    for (const [avaliador, motivo] of casos) {
      const id = await pedir(OUTRO.codigo);
      await criarTrabalhadorAvaliacao({ cliente: app, avaliadores: avaliador ? { [OUTRO.codigo]: avaliador } : {} })({ avaliacaoId: id });
      expect(await linha(id), motivo).toMatchObject({ situacao: 'FALHOU', erro: motivo });
    }
  });

  it('pendente vencida: o trabalhador não a toma, e o pedido novo a fecha como falha', async () => {
    const { rows } = await migrator.query(
      `INSERT INTO ia_avaliacao (caso_uso_codigo, usuario_id, criado_em) VALUES ($1, $2, clock_timestamp() - interval '31 minutes') RETURNING id`,
      [VENCIDO.codigo, usuarioId],
    );
    const velha = rows[0].id;
    expect((await obterTelaIA(ctx(['consultar']), { cliente: app })).casos.find((c) => c.codigo === VENCIDO.codigo)?.ultimaAvaliacao).toMatchObject({ situacao: 'PENDENTE', vencida: true });
    let chamou = false;
    await criarTrabalhadorAvaliacao({ cliente: app, avaliadores: { [VENCIDO.codigo]: async () => ((chamou = true), { total: 1, acertos: 1 }) } })({ avaliacaoId: velha });
    expect(chamou).toBe(false);
    const nova = await pedir(VENCIDO.codigo);
    expect(nova).not.toBe(velha);
    expect(await linha(velha)).toMatchObject({ situacao: 'FALHOU', erro: MSG_AVALIACAO_VENCIDA });
  });

  it('o app não apaga, não reescreve uma concluída nem volta a pendente (trigger de conclusão única)', async () => {
    await expect(app.$executeRaw`DELETE FROM "ia_avaliacao"`).rejects.toThrow();
    const pendente = await pedir(OUTRO.codigo);
    await expect(app.iaAvaliacao.update({ where: { id: pendente }, data: { situacao: 'CONCLUIDA' } })).rejects.toThrow();
    const [{ id: concluida }] = (await migrator.query(`SELECT id FROM ia_avaliacao WHERE situacao = 'CONCLUIDA' LIMIT 1`)).rows;
    await expect(app.iaAvaliacao.update({ where: { id: concluida }, data: { acertos: 10 } })).rejects.toThrow(/já concluída/);
    await expect(app.iaAvaliacao.update({ where: { id: concluida }, data: { situacao: 'PENDENTE', total: null, acertos: null, concluidoEm: null } })).rejects.toThrow(/já concluída/);
    await expect(migrator.query(`UPDATE ia_avaliacao SET erro = 'x' WHERE id = $1`, [concluida])).rejects.toThrow(/já concluída/);
  });
});
