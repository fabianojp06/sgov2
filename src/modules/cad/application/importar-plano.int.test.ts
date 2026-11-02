import ExcelJS from 'exceljs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma } from '@/shared/db';
import { totalizar } from '@/shared/totalizer';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { COLUNAS_PLANO_CONTAS } from '../domain/plano-contas';
import oficial from '../infrastructure/dados/plano-contas-oficial.json';
import { carregarIndiceEstrutura, ehContaAnaliticaAtiva, listarArvoreContas } from '../infrastructure/estrutura-financeira';
import { iniciarProcessadorCargas } from '../infrastructure/processador-cargas';
import { consultarCarga, solicitarCargaPlanoContas } from './importar-estrutura';

// US-043 parte 2 (plano do P4, Task 4b, Step 1): staging no app (sgo_app), merge no worker
// (sgo_sync), com Postgres real (Testcontainers, D12).
type Celulas = Record<(typeof COLUNAS_PLANO_CONTAS)[number], string | null>;
const OFICIAL = (oficial as { numero: number; celulas: Celulas }[]).map((l) => l.celulas);

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let sync: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;

const ctx = (perfil: 'GFIN' | 'ORCAMENTISTA' | 'ANALISTA_GRH'): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: `Teste ${perfil}`,
  sessaoUid: 'sessao-teste',
  ip: '127.0.0.1',
  permissoes: new Set(
    perfil === 'GFIN' ? ['cad.plano_contas:consultar', 'cad.plano_contas:executar'] : perfil === 'ANALISTA_GRH' ? ['cad.cargos:executar'] : ['cad.plano_contas:consultar'],
  ),
});

async function xlsx(linhas: readonly Celulas[]): Promise<{ nome: string; conteudo: Uint8Array }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plano de Contas');
  ws.addRow([...COLUNAS_PLANO_CONTAS]);
  for (const l of linhas) ws.addRow(COLUNAS_PLANO_CONTAS.map((c) => l[c]));
  return { nome: 'Plano_de_Contas.xlsx', conteudo: new Uint8Array(await wb.xlsx.writeBuffer()) };
}

const processador = (cliente: PrismaClient = sync, agora?: () => Date) =>
  iniciarProcessadorCargas({ clienteSync: cliente, automatico: false, ...(agora ? { agora } : {}) });

async function carregar(linhas: readonly Celulas[] = OFICIAL): Promise<string> {
  const r = await solicitarCargaPlanoContas(ctx('GFIN'), await xlsx(linhas), { cliente: app });
  if (!r.ok) throw new Error(`solicitação recusada: ${JSON.stringify(r.erros.slice(0, 3))}`);
  return r.valor.cargaId;
}

async function estado(cargaId: string) {
  const e = await consultarCarga(ctx('GFIN'), cargaId, { cliente: app });
  if (!e) throw new Error('lote não encontrado');
  return e;
}

const contarStaging = async (cargaId?: string) =>
  Number((await migrator.query(`SELECT count(*) AS n FROM carga_estrutura_linha ${cargaId ? 'WHERE carga_id = $1' : ''}`, cargaId ? [cargaId] : [])).rows[0].n);

// Cada teste parte de um banco sem estrutura (só o migrator apaga).
async function zerar(): Promise<void> {
  await migrator.query('BEGIN');
  await migrator.query('SET CONSTRAINTS ALL IMMEDIATE');
  for (let nivel = 5; nivel >= 1; nivel--) await migrator.query('DELETE FROM conta_contabil WHERE nivel = $1', [nivel]);
  await migrator.query('DELETE FROM carga_estrutura');
  await migrator.query('COMMIT');
}

const comClassificacao = (classificacao: string, mudar: Partial<Celulas>): Celulas[] =>
  OFICIAL.map((l) => (l['Classificação'] === classificacao ? { ...l, ...mudar } : l));

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  sync = criarPrisma(banco.urlMigrator.replace('sgo_migrator:sgo_migrator', 'sgo_sync:sgo_sync'));
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Gestor Financeiro', 'gfin@exemplo.org', 'gfin', 'gfin', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), sync?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

beforeEach(async () => {
  await zerar();
  vi.restoreAllMocks();
});

describe('carga do plano de contas', () => {
  it('fluxo completo: PENDENTE → um ciclo → CONCLUIDA, 174 contas, Histórico com o usuário do lote e staging vazio', async () => {
    const id = await carregar();
    expect((await estado(id)).situacao).toBe('PENDENTE');
    expect(await contarStaging(id)).toBe(174);
    await processador().executarCiclo();
    const e = await estado(id);
    expect(e).toMatchObject({ situacao: 'CONCLUIDA', linhas: 174, incluidas: 174, alteradas: 0, inativadas: 0, inalteradas: 0, erros: [], erro: null });
    expect(await sync.contaContabil.count()).toBe(174);
    expect(await contarStaging(id)).toBe(0);
    const h = await migrator.query(
      `SELECT tipo_operacao AS tipo, usuario_id, count(*)::int AS n FROM historico_operacao WHERE funcionalidade = 'cad.plano_contas' GROUP BY 1, 2`,
    );
    // 174 inclusões e o pedido de importação, todos com o usuário do lote.
    expect(h.rows).toEqual([{ tipo: 'INSERCAO', usuario_id: usuarioId, n: 175 }]);
  });

  it('carga só como sgo_sync (S-N1): com o cliente do sgo_app, nada é aplicado e o lote continua PENDENTE', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar();
    await processador(app).executarCiclo();
    expect(erro).toHaveBeenCalledWith('[CARGA_PAPEL_INVALIDO]', { papel: 'sgo_app' });
    expect((await estado(id)).situacao).toBe('PENDENTE');
    expect(await sync.contaContabil.count()).toBe(0);
    expect(await contarStaging(id)).toBe(174);
  });

  it('recarga idempotente (M-n2): nada muda e o Histórico ganha só o pedido', async () => {
    await carregar();
    await processador().executarCiclo();
    const antes = (await migrator.query('SELECT max(atualizado_em) AS m FROM conta_contabil')).rows[0].m;
    const historicoAntes = (await migrator.query('SELECT count(*)::int AS n FROM historico_operacao')).rows[0].n;
    const id = await carregar();
    await processador().executarCiclo();
    expect(await estado(id)).toMatchObject({ situacao: 'CONCLUIDA', incluidas: 0, alteradas: 0, inativadas: 0, inalteradas: 174 });
    expect((await migrator.query('SELECT max(atualizado_em) AS m FROM conta_contabil')).rows[0].m).toEqual(antes);
    expect((await migrator.query('SELECT count(*)::int AS n FROM historico_operacao')).rows[0].n).toBe(historicoAntes + 1);
  });

  it('recarga não muda classificação (R5): reduzido 900 numa classificação nova inativa a antiga, cria a nova e avisa', async () => {
    await carregar();
    await processador().executarCiclo();
    const linhas = OFICIAL.filter((l) => l['Classificação'] !== '4.1.1.1.001');
    linhas.push({ ...OFICIAL[4]!, Classificação: '4.1.1.1.099', 'Conta Reduzida': '900' });
    const id = await carregar(linhas);
    await processador().executarCiclo();
    const e = await estado(id);
    expect(e).toMatchObject({ situacao: 'CONCLUIDA', incluidas: 1, inativadas: 1 });
    expect(e.avisos).toEqual([expect.objectContaining({ coluna: 'Classificação', mensagem: expect.stringContaining('4.1.1.1.001') })]);
    const contas = await sync.contaContabil.findMany({ where: { codigoReduzido: '900' }, orderBy: { classificacao: 'asc' } });
    expect(contas.map((c) => [c.classificacao, c.ativa])).toEqual([
      ['4.1.1.1.001', false],
      ['4.1.1.1.099', true],
    ]);
  });

  it('o trigger recusa mudar a classificação, mesmo como sgo_sync', async () => {
    await carregar();
    await processador().executarCiclo();
    await expect(sync.$executeRaw`UPDATE conta_contabil SET classificacao = '4.1.1.1.777' WHERE classificacao = '4.1.1.1.001'`).rejects.toThrow(
      /estrutura de uma conta não muda/,
    );
  });

  it('erro da R5 por linha na tela (E-N2): mesma classificação com outro reduzido, sem lote', async () => {
    await carregar();
    await processador().executarCiclo();
    const r = await solicitarCargaPlanoContas(ctx('GFIN'), await xlsx(comClassificacao('4.1.1.1.001', { 'Conta Reduzida': '9999' })), {
      cliente: app,
    });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'linhas.6.Conta Reduzida', mensagem: expect.stringContaining('já existe com o reduzido 900') }] });
    expect(await sync.cargaEstrutura.count()).toBe(1);
  });

  it('divergência sob o lock (E-N2): o banco muda entre o pedido e o ciclo → FALHOU com erros por linha', async () => {
    await carregar();
    await processador().executarCiclo();
    const id = await carregar(comClassificacao('4.1.1.1.001', { Descrição: 'Salários e ordenados' }));
    // Alguém muda o banco por fora entre o pedido e o ciclo: a 4.1.1.1.001 passa a ter outro reduzido.
    await migrator.query('ALTER TABLE conta_contabil DISABLE TRIGGER conta_contabil_imutavel');
    try {
      await migrator.query(`UPDATE conta_contabil SET codigo_reduzido = '9998' WHERE classificacao = '4.1.1.1.001'`);
    } finally {
      await migrator.query('ALTER TABLE conta_contabil ENABLE TRIGGER conta_contabil_imutavel');
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await processador().executarCiclo();
    const e = await estado(id);
    expect(e.situacao).toBe('FALHOU');
    expect(e.erros).toEqual([expect.objectContaining({ linha: 6, coluna: 'Conta Reduzida' })]);
    expect(await contarStaging(id)).toBe(0);
  });

  it('conta ausente fica inativa; sintética sem filho ativo inativa junto (M-n3)', async () => {
    await carregar();
    await processador().executarCiclo();
    // Sem toda a 4.1.1.5: as analíticas e a sintética ficam inativas.
    const id = await carregar(OFICIAL.filter((l) => !l['Classificação']!.startsWith('4.1.1.5')));
    await processador().executarCiclo();
    const e = await estado(id);
    expect(e.situacao).toBe('CONCLUIDA');
    expect(await sync.contaContabil.count({ where: { classificacao: { startsWith: '4.1.1.5' }, ativa: true } })).toBe(0);
    expect(await ehContaAnaliticaAtiva(sync, '4.1.1.5.005')).toBe(false);
  });

  it('pai ativo (M-n3): o banco recusa conta ativa sob sintética inativa', async () => {
    await carregar();
    await processador().executarCiclo();
    await expect(
      sync.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE conta_contabil SET ativa = false, inativada_em = now() WHERE classificacao = '4.1.1.5'`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    ).rejects.toThrow(/inativa com conta ativa abaixo/);
  });

  it('carga atômica: uma linha inválida reprova tudo, sem lote nem staging', async () => {
    const r = await solicitarCargaPlanoContas(ctx('GFIN'), await xlsx(comClassificacao('4.1.1.1.003', { Nível: '6' })), { cliente: app });
    expect(r.ok).toBe(false);
    expect(await sync.cargaEstrutura.count()).toBe(0);
    expect(await contarStaging()).toBe(0);
  });

  it('carga concorrente: com uma PENDENTE, a segunda é recusada na hora', async () => {
    await carregar();
    const r = await solicitarCargaPlanoContas(ctx('GFIN'), await xlsx(OFICIAL), { cliente: app });
    expect(r).toEqual({
      ok: false,
      erros: [{ campo: 'arquivo', mensagem: 'Já existe uma carga do plano de contas em andamento. Tente de novo em instantes.' }],
    });
  });

  it('queda no meio (S-N2): PROCESSANDO há 16 min vira FALHOU "processamento interrompido", com o staging apagado', async () => {
    const id = await carregar();
    await sync.cargaEstrutura.update({ where: { id }, data: { situacao: 'PROCESSANDO', processandoDesde: new Date(Date.now() - 16 * 60_000) } });
    await processador().executarCiclo();
    expect(await estado(id)).toMatchObject({ situacao: 'FALHOU', erro: 'processamento interrompido' });
    expect(await contarStaging(id)).toBe(0);
  });

  it('pendente expirado: PENDENTE com 25 h vira FALHOU "expirada"', async () => {
    const id = await carregar();
    await processador(sync, () => new Date(Date.now() + 25 * 3600_000)).executarCiclo();
    expect(await estado(id)).toMatchObject({ situacao: 'FALHOU', erro: 'expirada' });
    expect(await contarStaging(id)).toBe(0);
    expect(await sync.contaContabil.count()).toBe(0);
  });

  it('falha não reprocessa (S-N2, E-N1): lote que falha no merge fica FALHOU e os ciclos seguintes não o tocam', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar();
    // Staging adulterado como migrator: nível trocado (S-N3).
    await migrator.query(`UPDATE carga_estrutura_linha SET dados = jsonb_set(dados, '{nivel}', '4') WHERE carga_id = $1 AND numero = 6`, [id]);
    const p = processador();
    await p.executarCiclo();
    const e = await estado(id);
    expect(e).toMatchObject({ situacao: 'FALHOU', erro: 'As linhas da carga não passaram na revalidação.' });
    expect(e.erros.length).toBeGreaterThan(0);
    expect(await contarStaging(id)).toBe(0);
    const depois = (await migrator.query('SELECT concluido_em FROM carga_estrutura WHERE id = $1', [id])).rows[0].concluido_em;
    for (let i = 0; i < 3; i++) await p.executarCiclo();
    expect((await migrator.query('SELECT concluido_em FROM carga_estrutura WHERE id = $1', [id])).rows[0].concluido_em).toEqual(depois);
    expect(await sync.contaContabil.count()).toBe(0);
  });

  it('revalidação no worker (S-N3): campo a mais no staging → FALHOU com erro na linha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar();
    await migrator.query(`UPDATE carga_estrutura_linha SET dados = dados || '{"ativa": false}' WHERE carga_id = $1 AND numero = 7`, [id]);
    await processador().executarCiclo();
    expect((await estado(id)).erros).toEqual([{ linha: 7, mensagem: 'Linha adulterada no staging.' }]);
  });

  it('sgo_app não muda a situação do lote nem grava resultado no INSERT (S-N3)', async () => {
    const id = await carregar();
    await expect(app.$executeRaw`UPDATE carga_estrutura SET situacao = 'CONCLUIDA' WHERE id = ${id}::uuid`).rejects.toThrow(/permission denied/);
    await expect(
      app.$executeRaw`INSERT INTO carga_estrutura (tipo, arquivo_nome, arquivo_sha256, linhas, contexto_auditoria, incluidas)
        VALUES ('CENTROS_CUSTO', 'x', 'y', 1, '{}', 5)`,
    ).rejects.toThrow(/permission denied/);
  });

  it('§10.2: com o auditar falhando no merge, o lote fica FALHOU e nada é aplicado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await carregar();
    // O Histórico recusa a escrita do sgo_sync só durante o ciclo.
    await migrator.query('REVOKE INSERT ON historico_operacao FROM sgo_sync');
    try {
      await processador().executarCiclo();
    } finally {
      await migrator.query(`GRANT INSERT ("unidade_id", "usuario_id", "usuario_rotulo", "sessao_uid", "ip", "funcionalidade",
        "tipo_operacao", "registro_id", "descricao", "antes", "depois", "delta", "origem") ON historico_operacao TO sgo_sync`);
    }
    expect((await estado(id)).situacao).toBe('FALHOU');
    expect(await sync.contaContabil.count()).toBe(0);
  });

  it('§10.2: ORCAMENTISTA não pede carga (ErroPermissao)', async () => {
    await expect(solicitarCargaPlanoContas(ctx('ORCAMENTISTA'), await xlsx(OFICIAL), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('consultarCarga (M-n1): ANALISTA_GRH não vê um lote do plano de contas; id inválido → null', async () => {
    const id = await carregar();
    expect(await consultarCarga(ctx('ANALISTA_GRH'), id, { cliente: app })).toBeNull();
    expect(await consultarCarga(ctx('GFIN'), 'nao-e-uuid', { cliente: app })).toBeNull();
  });

  it('C1 real: 162 folhas, analítica ativa e inativa, subárvore de pessoal e totalizar', async () => {
    await carregar();
    await processador().executarCiclo();
    const arvore = await listarArvoreContas(sync);
    const folhas = (nos: typeof arvore): number => nos.reduce((t, n) => t + (n.filhos.length === 0 ? 1 : folhas(n.filhos)), 0);
    expect(folhas(arvore)).toBe(162);
    expect(await ehContaAnaliticaAtiva(app, '4.1.1.1.001')).toBe(true);
    expect(await ehContaAnaliticaAtiva(app, '4.1.1.1')).toBe(false);
    const indice = await carregarIndiceEstrutura(app);
    expect(indice.contasAnaliticasSob('4.1.1.1')).toHaveLength(25);
    expect(totalizar(indice.nosContas, new Map()).total.paraString()).toBe('0.00');
    expect(() => indice.centrosCustoAnaliticosSob('4')).toThrow(expect.objectContaining({ codigo: 'cad.estrutura_indisponivel' }));
  });

  it('desempenho (RNF_DES_003): 10.000 linhas do pedido até CONCLUIDA em menos de 30 s', async () => {
    const linhas: Celulas[] = OFICIAL.slice(0, 4).map((l) => ({ ...l }));
    for (let i = 1; linhas.length < 10_000; i++) {
      linhas.push({ Nível: '5', Classificação: `4.1.1.1.${i}`, 'Conta Superior': '4.1.1.1', Descrição: `Conta ${i}`, Tipo: 'A', 'Conta Reduzida': String(100000 + i) });
    }
    const inicio = performance.now();
    const id = await carregar(linhas);
    await processador().executarCiclo();
    const ms = performance.now() - inicio;
    expect(await estado(id)).toMatchObject({ situacao: 'CONCLUIDA', incluidas: 10_000 });
    process.stderr.write(`[DESEMPENHO] 10.000 linhas em ${Math.round(ms)} ms\n`);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
});
