import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { EventoAuditoria } from '@/shared/audit';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { criarCifraSalarios } from '../infrastructure/cifra-salarios';
import { alterarCargo } from './cargos';
import {
  alterarFaixaSalarial,
  copiarFaixaParaCargo,
  inativarFaixaSalarial,
  inativarSenioridade,
  incluirFaixaSalarial,
  incluirSenioridade,
  listarTabelaSalarial,
  MSG_SENIORIDADE_COM_FAIXA,
  MSG_SENIORIDADE_PADRAO,
} from './tabela-salarial';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { acaoIncluirFaixa } = await import('./acoes-tabela-salarial');

// US-049 parte 3 (plano do P4, Task 12c, Step 1; UC03.19 §5), num Postgres real (Testcontainers, D12).
const cifra = criarCifraSalarios({ CHAVE_CIFRA_SALARIOS: Buffer.alloc(32, 5).toString('base64'), CHAVE_CIFRA_SALARIOS_ID: 'k5' });

let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let usuarioId: string;
let cargoId: string;
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (...p: [string, string][]): ContextoRequisicao => ({ usuarioId, usuarioRotulo: 'grh', sessaoUid: 's', ip: '127.0.0.1', permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)) });
const grh = () =>
  ctx(
    ['cad.tabela_salarial', 'consultar'],
    ['cad.tabela_salarial', 'incluir'],
    ['cad.tabela_salarial', 'alterar'],
    ['cad.tabela_salarial', 'excluir'],
    ['cad.cargos', 'alterar'],
    ['cad.salarios', 'consultar'],
  );
const gfin = () => ctx(['cad.tabela_salarial', 'consultar']);
const sen = async (nome: string) => (await migrator.query('SELECT id FROM senioridade WHERE nome = $1', [nome])).rows[0].id as string;
const versaoCargo = async () => (await migrator.query('SELECT versao FROM cargo WHERE id = $1', [cargoId])).rows[0].versao as number;
const faixa = async (senioridade = 'Pleno', minimo = '6000', maximo = '9000') => {
  const r = await incluirFaixaSalarial(grh(), { cargoId, senioridadeId: await sen(senioridade), minimo, maximo }, { cliente: app });
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor.id;
};

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  app = criarPrisma(banco.urlApp);
  global_.__sgoPrisma = app;
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ('GRH', 'g@exemplo.org', 'g', 'g', 'x') RETURNING id`);
  usuarioId = rows[0].id;
  cargoId = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial) VALUES ('C1', 'Analista') RETURNING id`)).rows[0].id;
}, 180_000);

afterAll(async () => {
  try {
    await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  } finally {
    delete global_.__sgoPrisma;
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.query('DELETE FROM faixa_salarial');
  await migrator.query('DELETE FROM senioridade WHERE NOT padrao');
  contexto = grh();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('faixas salariais (REQ_TAB_001)', () => {
  it('as senioridades padrão vêm da migration: Júnior, Pleno e Sênior', async () => {
    const { senioridades } = await listarTabelaSalarial(gfin(), {}, { cliente: app });
    expect(senioridades.map((s) => [s.nome, s.padrao])).toEqual([
      ['Júnior', true],
      ['Pleno', true],
      ['Sênior', true],
    ]);
  });

  it('RN_TAB_02: mínimo ≥ máximo → erro nos dois campos; RN_TAB_03: dois registros do mesmo par são aceitos', async () => {
    const r = await incluirFaixaSalarial(grh(), { cargoId, senioridadeId: await sen('Pleno'), minimo: '9000', maximo: '9000' }, { cliente: app });
    expect(r.ok ? [] : r.erros.map((e) => e.campo)).toEqual(['minimo', 'maximo']);
    await faixa('Pleno', '6000', '9000');
    await faixa('Pleno', '6500,50', '9500');
    const { faixas } = await listarTabelaSalarial(gfin(), { cargoId }, { cliente: app });
    expect(faixas.map((f) => [f.senioridade, f.minimo, f.maximo])).toEqual([
      ['Pleno', '6000.00', '9000.00'],
      ['Pleno', '6500.50', '9500.00'],
    ]);
    await expect(migrator.query(`UPDATE faixa_salarial SET minimo = maximo`)).rejects.toThrow(/faixa_salarial_valores_check/);
  });

  it('alterar com versão velha → concorrência; inativar; GFIN não inclui (ErroPermissao)', async () => {
    const id = await faixa();
    const dados = { cargoId, senioridadeId: await sen('Sênior'), minimo: '7000', maximo: '10000' };
    expect(await alterarFaixaSalarial(grh(), id, 1, dados, { cliente: app })).toEqual({ ok: true, valor: { versao: 2 } });
    expect((await alterarFaixaSalarial(grh(), id, 1, dados, { cliente: app })).ok).toBe(false);
    expect((await inativarFaixaSalarial(grh(), id, 2, { cliente: app })).ok).toBe(true);
    await expect(incluirFaixaSalarial(gfin(), dados, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('pela ação, sem incluir: 403 auditado (§10.2)', async () => {
    contexto = gfin();
    expect(await acaoIncluirFaixa({ cargoId, senioridadeId: await sen('Pleno'), minimo: '1', maximo: '2' })).toMatchObject({ ok: false, status: 403 });
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.tabela_salarial' })]);
  });

  it('com a auditoria falhando, nada é gravado (§10.2)', async () => {
    await migrator.query('REVOKE INSERT ON historico_operacao FROM sgo_app');
    try {
      await expect(incluirFaixaSalarial(grh(), { cargoId, senioridadeId: await sen('Pleno'), minimo: '6000', maximo: '9000' }, { cliente: app })).rejects.toThrow(/permission denied/);
    } finally {
      await migrator.query(`GRANT INSERT ("unidade_id", "usuario_id", "usuario_rotulo", "sessao_uid", "ip", "funcionalidade",
        "tipo_operacao", "registro_id", "descricao", "antes", "depois", "delta", "origem") ON historico_operacao TO sgo_app`);
    }
    expect((await migrator.query('SELECT count(*)::int AS n FROM faixa_salarial')).rows[0].n).toBe(0);
  });
});

describe('senioridades (RN_TAB_01, E4)', () => {
  it('inativar "Pleno" → erro; inativar uma customizada com faixa ativa → erro; sem faixa ativa, inativa', async () => {
    expect(await inativarSenioridade(grh(), await sen('Pleno'), { cliente: app })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MSG_SENIORIDADE_PADRAO }] });
    await expect(migrator.query(`UPDATE senioridade SET ativa = false WHERE nome = 'Pleno'`)).rejects.toThrow(/padrão/);
    const r = await incluirSenioridade(grh(), 'Especialista', { cliente: app });
    if (!r.ok) throw new Error('recusada');
    expect((await incluirSenioridade(grh(), 'especialista', { cliente: app })).ok).toBe(false);
    const idFaixa = await faixa('Especialista');
    expect(await inativarSenioridade(grh(), r.valor.id, { cliente: app })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: MSG_SENIORIDADE_COM_FAIXA }] });
    await inativarFaixaSalarial(grh(), idFaixa, 1, { cliente: app });
    expect((await inativarSenioridade(grh(), r.valor.id, { cliente: app })).ok).toBe(true);
  });
});

describe('cópia da faixa para o cargo (REQ_TAB_003/005, RN_TAB_04)', () => {
  it('copia mínimo e máximo com o rótulo "Preenchido via Tabela Salarial — <cargo>/<senioridade>"; a edição manual troca para "Editado manualmente"', async () => {
    const id = await faixa('Sênior', '8000', '12000');
    const v = await versaoCargo();
    expect(await copiarFaixaParaCargo(grh(), cargoId, id, 1, v, { cliente: app })).toEqual({ ok: true, valor: { versao: v + 1 } });
    const c = (await migrator.query('SELECT mercado_minimo::text AS mi, mercado_maximo::text AS ma, origem_mercado_rotulo AS r FROM cargo WHERE id = $1', [cargoId])).rows[0];
    expect(c).toEqual({ mi: '8000.00', ma: '12000.00', r: 'Preenchido via Tabela Salarial — Analista/Sênior' });
    await alterarCargo(grh(), cargoId, v + 1, { mercadoMinimo: '8100', mercadoMaximo: '12000', periculosidade: false, insalubridade: null, fonteAtiva: null }, { cliente: app, cifra });
    expect((await migrator.query('SELECT origem_mercado_rotulo AS r FROM cargo WHERE id = $1', [cargoId])).rows[0].r).toBe('Editado manualmente');
  });

  it('sem cad.salarios: ErroPermissao; versão velha: concorrência; faixa inativa: recusada', async () => {
    const id = await faixa();
    await expect(copiarFaixaParaCargo(ctx(['cad.cargos', 'alterar']), cargoId, id, 1, await versaoCargo(), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    expect((await copiarFaixaParaCargo(grh(), cargoId, id, 1, 999, { cliente: app })).ok).toBe(false);
    // Versão da faixa que o usuário não viu.
    expect((await copiarFaixaParaCargo(grh(), cargoId, id, 7, await versaoCargo(), { cliente: app })).ok).toBe(false);
    await inativarFaixaSalarial(grh(), id, 1, { cliente: app });
    expect((await copiarFaixaParaCargo(grh(), cargoId, id, 2, await versaoCargo(), { cliente: app })).ok).toBe(false);
  });
});

describe('regras que os mutantes pegam', () => {
  it('cópia de faixa de outro cargo é recusada; alterar faixa inativa é recusado; o filtro por cargo vale', async () => {
    const outro = (await migrator.query(`INSERT INTO cargo (codigo, nome_oficial) VALUES ('C2', 'Outro') RETURNING id`)).rows[0].id as string;
    try {
      const r = await incluirFaixaSalarial(grh(), { cargoId: outro, senioridadeId: await sen('Pleno'), minimo: '1000', maximo: '2000' }, { cliente: app });
      if (!r.ok) throw new Error('recusada');
      expect(await copiarFaixaParaCargo(grh(), cargoId, r.valor.id, 1, await versaoCargo(), { cliente: app })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'A faixa deve ser do mesmo cargo.' }] });
      await faixa();
      expect((await listarTabelaSalarial(gfin(), { cargoId }, { cliente: app })).faixas.map((f) => f.cargoId)).toEqual([cargoId]);
      await inativarFaixaSalarial(grh(), r.valor.id, 1, { cliente: app });
      expect((await alterarFaixaSalarial(grh(), r.valor.id, 2, { cargoId: outro, senioridadeId: await sen('Pleno'), minimo: '1', maximo: '2' }, { cliente: app })).ok).toBe(false);
    } finally {
      await migrator.query('DELETE FROM faixa_salarial');
      await migrator.query(`DELETE FROM cargo WHERE codigo = 'C2'`);
    }
  });

  it('reincluir o nome de uma senioridade inativa a reativa', async () => {
    const r = await incluirSenioridade(grh(), 'Trainee', { cliente: app });
    if (!r.ok) throw new Error('recusada');
    await inativarSenioridade(grh(), r.valor.id, { cliente: app });
    expect(await incluirSenioridade(grh(), 'trainee', { cliente: app })).toEqual({ ok: true, valor: { id: r.valor.id, nome: 'Trainee', reativada: true } });
    expect((await migrator.query('SELECT ativa FROM senioridade WHERE id = $1', [r.valor.id])).rows[0].ativa).toBe(true);
  });

  it('a ação de cópia: 403 auditado sem alterar; campo blindado no pedido é auditado (M-n4)', async () => {
    const { acaoCopiarFaixaParaCargo } = await import('./acoes-tabela-salarial');
    const id = await faixa();
    contexto = gfin();
    const v = await versaoCargo();
    expect(await acaoCopiarFaixaParaCargo({ idCargo: cargoId, idFaixa: id, versaoFaixa: 1, versao: 1 })).toMatchObject({ ok: false, status: 403 });
    expect(await versaoCargo()).toBe(v);
    expect(negacoes).toEqual([expect.objectContaining({ funcionalidade: 'cad.cargos' })]);
    contexto = grh();
    const antes = Number((await migrator.query('SELECT count(*) AS n FROM historico_operacao')).rows[0].n);
    expect(await acaoCopiarFaixaParaCargo({ idCargo: cargoId, idFaixa: id, versaoFaixa: 1, versao: 1, origemMercadoRotulo: 'x' })).toMatchObject({ ok: false });
    expect(Number((await migrator.query('SELECT count(*) AS n FROM historico_operacao')).rows[0].n)).toBe(antes + 1);
  });
});

describe('privilégios (B1)', () => {
  it('o app lê, inclui e altera só as colunas de valor; ninguém apaga; o sgo_sync não toca', async () => {
    const t = await migrator.query(
      `SELECT table_name || ' ' || grantee || ' ' || privilege_type AS l FROM information_schema.role_table_grants
       WHERE table_name IN ('senioridade', 'faixa_salarial') AND grantee IN ('sgo_app', 'sgo_sync', 'sgo_fila', 'sgo_leitura') ORDER BY 1`,
    );
    expect(t.rows.map((r) => r.l)).toEqual(['faixa_salarial sgo_app INSERT', 'faixa_salarial sgo_app SELECT', 'senioridade sgo_app INSERT', 'senioridade sgo_app SELECT']);
    const c = await migrator.query(
      `SELECT c.relname || '.' || a.attname || ' ' || r.rolname || ' ' || x.privilege_type AS l
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
       WHERE c.relname IN ('senioridade', 'faixa_salarial') AND r.rolname IN ('sgo_app', 'sgo_sync') AND a.attacl IS NOT NULL ORDER BY 1`,
    );
    expect(c.rows.map((r) => r.l)).toEqual(
      [
        ...['ativa', 'atualizado_em', 'cargo_id', 'maximo', 'minimo', 'senioridade_id', 'versao'].map((x) => `faixa_salarial.${x} sgo_app UPDATE`),
        'senioridade.ativa sgo_app UPDATE',
      ].sort(),
    );
  });
});
