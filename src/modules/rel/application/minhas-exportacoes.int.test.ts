import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { seedAdm } from '@/modules/adm';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { seedRel } from '../infrastructure/seed';
import { baixarExportacao, listarMinhasExportacoes } from './minhas-exportacoes';

// Minhas exportações (US-024, parte 4) num Postgres real (Testcontainers, D12): cada pessoa vê só os
// próprios pedidos dos últimos 7 dias, e baixar exige o pedido pronto e o exportar da listagem de origem.
// Os pedidos entram direto pelo migrator (a geração é testada no cad, exportar-estrutura.int.test.ts).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: PrismaClient;
let migrator: pg.Client;
let dono: string;
let outro: string;
const AGORA = new Date('2026-11-10T15:00:00.000Z');
const ids: Record<'pronta' | 'pendente' | 'falhou' | 'vencida' | 'alheia', string> = { pronta: '', pendente: '', falhou: '', vencida: '', alheia: '' };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const ctx = (usuarioId: string, ...p: [string, string][]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'gfin',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(p.map(([f, a]) => `${f}:${a}`)),
});
const LISTA: [string, string] = ['rel.exportacoes', 'consultar'];
const EXPORTA: [string, string] = ['cad.plano_contas', 'exportar'];

async function inserir(usuarioId: string, situacao: string, criadoEm: Date): Promise<string> {
  const pronta = situacao === 'PRONTA';
  const { rows } = await migrator.query(
    `INSERT INTO exportacao_pedido (usuario_id, usuario_rotulo, sessao_uid, funcionalidade, titulo, formato, parametros, situacao, registros, nome_arquivo, conteudo, erro, criado_em, concluido_em)
     VALUES ($1, 'gfin', 's', 'cad.plano_contas', 'Plano de contas', 'csv', '{}', $2, $3, 'plano-de-contas.csv', $4, $5, $6, $7) RETURNING id`,
    [
      usuarioId,
      situacao,
      pronta ? 2 : null,
      pronta ? Buffer.from('a;b\r\n') : null,
      situacao === 'FALHOU' ? 'Motivo da falha.' : null,
      criadoEm,
      situacao === 'PENDENTE' ? null : criadoEm,
    ],
  );
  return rows[0].id;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  await executarSeeds(m, [seedAdm, seedRel]);
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const usuario = async (login: string) =>
    (await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash) VALUES ($1, $2, $1, $1, 'x') RETURNING id`, [login, `${login}@exemplo.org`])).rows[0].id;
  dono = await usuario('dono');
  outro = await usuario('outro');
  const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000);
  ids.pronta = await inserir(dono, 'PRONTA', horasAtras(1));
  ids.pendente = await inserir(dono, 'PENDENTE', horasAtras(0.5));
  ids.falhou = await inserir(dono, 'FALHOU', horasAtras(2));
  ids.vencida = await inserir(dono, 'PRONTA', horasAtras(7 * 24 + 1));
  ids.alheia = await inserir(outro, 'PRONTA', horasAtras(1));
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('Minhas exportações (US-024)', () => {
  it('lista só os pedidos da pessoa, dos últimos 7 dias, do mais novo ao mais antigo', async () => {
    const lista = await listarMinhasExportacoes(ctx(dono, LISTA), { cliente: app, agora: AGORA });
    expect(lista.map((p) => p.id)).toEqual([ids.pendente, ids.pronta, ids.falhou]);
    expect(lista[2]).toMatchObject({ situacao: 'FALHOU', erro: 'Motivo da falha.', registros: null });
    expect(lista[1]).not.toHaveProperty('conteudo');
  });

  it('baixa o arquivo pronto do próprio pedido', async () => {
    const a = await baixarExportacao(ctx(dono, LISTA, EXPORTA), ids.pronta, { cliente: app, agora: AGORA });
    expect(a && { ...a, bytes: new TextDecoder().decode(a.bytes) }).toEqual({ nome: 'plano-de-contas.csv', formato: 'csv', bytes: 'a;b\r\n' });
  });

  it('pedido alheio, vencido, pendente, com falha ou id inválido: null', async () => {
    for (const id of [ids.alheia, ids.vencida, ids.pendente, ids.falhou, 'nao-e-uuid']) {
      expect(await baixarExportacao(ctx(dono, LISTA, EXPORTA), id, { cliente: app, agora: AGORA })).toBeNull();
    }
  });

  it('sem o exportar da listagem de origem (retirado depois do pedido): ErroPermissao', async () => {
    await expect(baixarExportacao(ctx(dono, LISTA), ids.pronta, { cliente: app, agora: AGORA })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('sem a consulta de Minhas exportações: ErroPermissao', async () => {
    await expect(listarMinhasExportacoes(ctx(dono), { cliente: app, agora: AGORA })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('a seed dá a consulta a todos os perfis', async () => {
    const { rows } = await migrator.query(
      `SELECT p.codigo FROM perfil p LEFT JOIN perfil_permissao pp ON pp.perfil_id = p.id AND pp.funcionalidade_codigo = 'rel.exportacoes' AND pp.acao = 'consultar' WHERE pp.perfil_id IS NULL`,
    );
    expect(rows).toEqual([]);
  });
});
