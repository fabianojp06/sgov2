import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdm } from '@/modules/adm';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroPermissao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { obterParametroSistema } from '../infrastructure/parametro-sistema';
import { seedCad } from '../infrastructure/seed';
import { alterarNomeExibicao, obterTelaInstituicao } from './instituicao';

// Nome de exibição da instituição (#434), com Postgres real e o papel sgo_app (só UPDATE do valor).
// Os testes compartilham o banco e dependem da ordem.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let app: ReturnType<typeof criarPrisma>;
let migrator: pg.Client;
let usuarioId: string;

const ctx = (permissoes: string[]): ContextoRequisicao => ({
  usuarioId,
  usuarioRotulo: 'Teste',
  sessaoUid: 's',
  ip: '127.0.0.1',
  permissoes: new Set(permissoes),
});
const admin = () => ctx(['cad.instituicao:consultar', 'cad.instituicao:alterar']);
const leitor = () => ctx(['cad.instituicao:consultar']);
const historicos = async () =>
  (await migrator.query(`SELECT funcionalidade, registro_id, antes, depois FROM historico_operacao WHERE funcionalidade = 'cad.instituicao' ORDER BY id`)).rows;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  const m = criarPrisma(banco.urlMigrator);
  await executarSeeds(m, [seedAdm, seedCad]);
  await m.$disconnect();
  app = criarPrisma(banco.urlApp);
  migrator = new pg.Client({ connectionString: banco.urlMigrator });
  await migrator.connect();
  const { rows } = await migrator.query(`INSERT INTO usuario (nome, email, login, login_normalizado, senha_hash)
    VALUES ('Admin', 'a@exemplo.org', 'a', 'a', 'x') RETURNING id`);
  usuarioId = rows[0].id;
}, 180_000);

afterAll(async () => {
  await Promise.allSettled([app?.$disconnect(), migrator?.end()]);
  await banco?.parar();
});

describe('nome de exibição da instituição', () => {
  it('catálogo: o Administrador altera, a GFIN e o Auditor consultam', async () => {
    const { rows } = await migrator.query(
      `SELECT p.codigo AS perfil, pp.acao FROM perfil_permissao pp JOIN perfil p ON p.id = pp.perfil_id
       WHERE pp.funcionalidade_codigo = 'cad.instituicao' ORDER BY 1, 2`,
    );
    expect(rows).toEqual([
      { perfil: 'ADMINISTRADOR', acao: 'alterar' },
      { perfil: 'ADMINISTRADOR', acao: 'consultar' },
      { perfil: 'AUDITOR', acao: 'consultar' },
      { perfil: 'GFIN', acao: 'consultar' },
    ]);
  });

  it('a seed deixa vazio; quem só consulta lê, mas não altera', async () => {
    expect(await obterTelaInstituicao(leitor(), { cliente: app })).toEqual({ nome: '' });
    await expect(alterarNomeExibicao(leitor(), { nome: 'X', anterior: '' }, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(obterTelaInstituicao(ctx([]), { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });

  it('o Administrador grava pelo sgo_app, sem os espaços das pontas, com o antes e o depois no Histórico', async () => {
    const r = await alterarNomeExibicao(admin(), { nome: '  Instituto Exemplo  ', anterior: '' }, { cliente: app });
    expect(r).toEqual({ ok: true, valor: { nome: 'Instituto Exemplo' } });
    expect(await obterParametroSistema(app, 'instituicao.nome_exibicao')).toBe('Instituto Exemplo');
    expect(await historicos()).toEqual([
      { funcionalidade: 'cad.instituicao', registro_id: 'instituicao.nome_exibicao', antes: { nome: '' }, depois: { nome: 'Instituto Exemplo' } },
    ]);
  });

  it('o mesmo valor de novo não grava nem registra', async () => {
    const r = await alterarNomeExibicao(admin(), { nome: 'Instituto Exemplo', anterior: 'Instituto Exemplo' }, { cliente: app });
    expect(r.ok).toBe(true);
    expect(await historicos()).toHaveLength(1);
  });

  it('valor anterior diferente do gravado (outra tela salvou antes) → concorrência, sem gravar', async () => {
    const r = await alterarNomeExibicao(admin(), { nome: 'Outro nome', anterior: '' }, { cliente: app });
    expect(r).toMatchObject({ ok: false, erros: [{ campo: '_', mensagem: expect.stringContaining('alterado por outro usuário') }] });
    expect(await obterParametroSistema(app, 'instituicao.nome_exibicao')).toBe('Instituto Exemplo');
  });

  it('nome inválido não grava; vazio volta ao padrão', async () => {
    expect(await alterarNomeExibicao(admin(), { nome: 'a\nb', anterior: 'Instituto Exemplo' }, { cliente: app })).toMatchObject({ ok: false, erros: [{ campo: 'nome' }] });
    expect(await alterarNomeExibicao(admin(), { nome: '', anterior: 'Instituto Exemplo' }, { cliente: app })).toEqual({ ok: true, valor: { nome: '' } });
    expect(await obterParametroSistema(app, 'instituicao.nome_exibicao')).toBe('');
  });
});
