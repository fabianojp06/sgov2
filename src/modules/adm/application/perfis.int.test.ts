import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estruturaFinanceiraFalsa } from '@/modules/cad/servidor';
import { emailFalso } from '@/modules/ger';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { MENSAGEM_CONFLITO } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_PERFIL } from '../domain/perfil';
import { MENSAGENS_USUARIO } from '../domain/usuario';
import { seedAdm } from '../infrastructure/seed';
import type { DeclaracaoFuncionalidade } from './catalogo';
import { obterEscopoCentroCusto } from './escopo-cc';
import { instalarFuncionalidades } from './instalar-funcionalidades';
import { carregarPermissoes } from './login';
import { alterarPerfil, excluirPerfil, gradePermissoes, incluirPerfil, listarPerfis, obterPerfil } from './perfis';
import { cadastrarUsuario } from './usuarios';

// Cadastro de perfis e permissões (US-037; plano do P13, D-P13-1 a D-P13-12, Review Focus 1 a 5 e
// ajustes A1, A2, A3, A5, A6 e A7 da revisão).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ctx: ContextoRequisicao;
const deps = () => ({ cliente: app });

// Funcionalidades só do teste, fora da Administração. cad.parado fica num módulo que o teste desativa.
const item = (codigo: string, modulo: DeclaracaoFuncionalidade['modulo'], ordem: number, acoes: DeclaracaoFuncionalidade['acoes'], perfisPadrao: DeclaracaoFuncionalidade['perfisPadrao'] = {}) =>
  ({ codigo, modulo, grupo: 'Grupo do teste', nome: `Tela ${codigo}`, rota: `/${codigo.replace('.', '/')}`, ordem, acoes, perfisPadrao }) satisfies DeclaracaoFuncionalidade;

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: a chave sai daqui.
const p = (funcionalidade: string, acao: string) => [funcionalidade, acao].join(':');

type Permissao = { funcionalidade: string; acoes: string[] };

// A grade como a tela a recebe: as funcionalidades exibidas saem do servidor (A1).
async function exibidas(perfilCodigo: string | null): Promise<string[]> {
  return (await gradePermissoes(ctx, perfilCodigo, deps())).flatMap((m) => m.funcionalidades.filter((f) => f.fixas.length === 0).map((f) => f.codigo));
}

async function dados(perfilCodigo: string | null, extra: { nome?: string; descricao?: string; ativo?: boolean; permissoes?: Permissao[]; confirmarInativacao?: boolean } = {}) {
  return {
    nome: extra.nome ?? 'Perfil do teste',
    descricao: extra.descricao ?? '',
    ativo: extra.ativo ?? true,
    permissoes: extra.permissoes ?? [{ funcionalidade: 'cad.um', acoes: ['consultar'] }],
    exibidas: await exibidas(perfilCodigo),
    ...(extra.confirmarInativacao === undefined ? {} : { confirmarInativacao: extra.confirmarInativacao }),
  };
}

async function criar(nome: string, permissoes: Permissao[] = [{ funcionalidade: 'cad.um', acoes: ['consultar'] }]): Promise<string> {
  const r = await incluirPerfil(ctx, await dados(null, { nome, permissoes }), deps());
  if (!r.ok) throw new Error(`cadastro falhou: ${JSON.stringify(r.erros)}`);
  return r.valor.id;
}

const perfil = (id: string) => migrator.perfil.findUniqueOrThrow({ where: { id } });
const porCodigo = (codigo: string) => migrator.perfil.findUniqueOrThrow({ where: { codigo } });

async function alterar(id: string, extra: Parameters<typeof dados>[1], versao?: number, contexto = ctx) {
  const atual = await perfil(id);
  const base = await obterPerfil(ctx, id, deps());
  // Como a tela: só as permissões das funcionalidades exibidas voltam no formulário.
  const naGrade = new Set(await exibidas(atual.codigo));
  const permissoes = base!.permissoes.filter((x) => naGrade.has(x.funcionalidade));
  return alterarPerfil(contexto, id, versao ?? atual.versao, await dados(atual.codigo, { nome: atual.nome, descricao: atual.descricao, ativo: atual.ativo, permissoes, ...extra }), deps());
}

const permissoesDoBanco = async (id: string) =>
  (await migrator.perfilPermissao.findMany({ where: { perfilId: id } })).map((x) => p(x.funcionalidadeCodigo, x.acao)).sort();
const historico = async (registroId: string) =>
  (await migrator.historicoOperacao.findMany({ where: { registroId, funcionalidade: 'adm.perfis' }, orderBy: { id: 'asc' } })).map((x) => [x.tipoOperacao, x.descricao]);
const mensagens = (r: { ok: boolean; erros?: readonly { mensagem: string }[] }) => (r.ok ? [] : r.erros!.map((e) => e.mensagem));

let seq = 0;
async function usuarioCom(perfilId: string, ativo = true): Promise<string> {
  seq++;
  const u = await migrator.usuario.create({
    data: { nome: `Usuário ${seq}`, email: `u${seq}@example.org`, login: `u${seq}`, loginNormalizado: `u${seq}`, senhaHash: 'x', ativo, perfis: { create: { perfilId } } },
  });
  return u.id;
}
const acesso = async (usuarioId: string) => (await migrator.usuario.findUniqueOrThrow({ where: { id: usuarioId } })).acessoVersao;

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  await migrator.$transaction((tx) =>
    instalarFuncionalidades(tx, [
      item('cad.um', 'CADASTROS', 1, ['consultar', 'incluir', 'alterar'], { GFIN: ['consultar'] }),
      item('cad.dois', 'CADASTROS', 2, ['consultar', 'exportar']),
      item('rel.um', 'RELATORIOS', 1, ['consultar']),
      item('rel.dois', 'RELATORIOS', 2, ['consultar']),
      item('orc.pacotes', 'ORCAMENTARIO', 1, ['consultar', 'incluir', 'alterar', 'excluir']),
    ]),
  );
  const raiz = await migrator.usuario.create({ data: { nome: 'Raiz', email: 'raiz@example.org', login: 'raiz', loginNormalizado: 'raiz', senhaHash: 'x' } });
  await migrator.usuarioPerfil.create({ data: { usuarioId: raiz.id, perfilId: (await porCodigo('ADMINISTRADOR')).id } });
  ctx = {
    usuarioId: raiz.id,
    usuarioRotulo: 'raiz',
    sessaoUid: 's-raiz',
    ip: '203.0.113.1',
    permissoes: new Set([...['consultar', 'incluir', 'alterar', 'excluir'].map((a) => p('adm.perfis', a)), p('adm.usuarios', 'incluir')]),
  };
}, 180_000);

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('cadastro (UC02.25)', () => {
  it('grava perfil, permissões e Histórico; o usuário associado recebe as permissões', async () => {
    const id = await criar('Consulta Cadastros', [
      { funcionalidade: 'cad.um', acoes: ['consultar', 'alterar'] },
      { funcionalidade: 'rel.um', acoes: ['consultar'] },
    ]);
    const novo = await perfil(id);
    expect(novo.codigo).toMatch(/^P_[0-9A-F]{12}$/);
    expect(novo).toMatchObject({ nome: 'Consulta Cadastros', ativo: true, versao: 0 });
    expect(await permissoesDoBanco(id)).toEqual([p('cad.um', 'alterar'), p('cad.um', 'consultar'), p('rel.um', 'consultar')]);
    expect(await historico(id)).toEqual([
      ['INSERCAO', 'Perfil Consulta Cadastros cadastrado'],
      ['INSERCAO', 'Funcionalidade Tela cad.um associada ao perfil Consulta Cadastros'],
      ['INSERCAO', 'Funcionalidade Tela rel.um associada ao perfil Consulta Cadastros'],
    ]);
    const usuario = await usuarioCom(id);
    expect([...(await carregarPermissoes(app, usuario))].sort()).toEqual([p('cad.um', 'alterar'), p('cad.um', 'consultar'), p('rel.um', 'consultar')]);
    const lista = await listarPerfis(ctx, deps());
    expect(lista.find((x) => x.id === id)).toMatchObject({ padrao: false, usuarios: 1, usuariosAtivos: 1 });
    expect(lista.find((x) => x.codigo === 'AUDITOR')).toMatchObject({ padrao: true });
  });

  it('sem funcionalidade (E2, RN0082) e com ação sem Consultar', async () => {
    expect(mensagens(await incluirPerfil(ctx, await dados(null, { nome: 'Vazio', permissoes: [] }), deps()))).toEqual([MENSAGENS_PERFIL.SEM_FUNCIONALIDADE]);
    expect(mensagens(await incluirPerfil(ctx, await dados(null, { nome: 'Sem consultar', permissoes: [{ funcionalidade: 'cad.um', acoes: ['alterar'] }] }), deps()))).toEqual([
      'Marque Consultar para dar outras ações em Tela cad.um.',
    ]);
  });

  it('nome repetido por caixa e espaços, inclusive com um padrão renomeado (Review Focus 2)', async () => {
    for (const nome of ['auditor', ' AUDITOR ', 'consulta cadastros']) {
      expect(mensagens(await incluirPerfil(ctx, await dados(null, { nome }), deps())), nome).toEqual([MENSAGENS_PERFIL.NOME_DUPLICADO]);
    }
    const auditor = await porCodigo('AUDITOR');
    expect((await alterar(auditor.id, { nome: 'Auditoria Interna' })).ok).toBe(true);
    expect(mensagens(await incluirPerfil(ctx, await dados(null, { nome: 'AUDITORIA INTERNA' }), deps()))).toEqual([MENSAGENS_PERFIL.NOME_DUPLICADO]);
    expect(mensagens(await alterar(await criar('Outro Nome'), { nome: 'auditoria interna' }))).toEqual([MENSAGENS_PERFIL.NOME_DUPLICADO]);
    expect((await alterar(auditor.id, { nome: 'Auditor' })).ok).toBe(true);
  });

  it('dois cadastros simultâneos com o mesmo nome: um grava, o outro recebe a mensagem (índice)', async () => {
    const [a, b] = await Promise.all([
      incluirPerfil(ctx, await dados(null, { nome: 'Corrida' }), deps()),
      incluirPerfil(ctx, await dados(null, { nome: 'CORRIDA' }), deps()),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([...mensagens(a), ...mensagens(b)]).toEqual([MENSAGENS_PERFIL.NOME_DUPLICADO]);
  });
});

describe('Administração trancada (Review Focus 1; D-P13-4, A2)', () => {
  it('perfil da tela e padrões que não o Administrador não recebem adm.*; o Auditor recebe só o Histórico', async () => {
    const forjado = [
      { funcionalidade: 'cad.um', acoes: ['consultar'] },
      { funcionalidade: 'adm.usuarios', acoes: ['consultar'] },
    ];
    expect(mensagens(await incluirPerfil(ctx, await dados(null, { nome: 'Forjado', permissoes: forjado }), deps()))).toEqual([MENSAGENS_PERFIL.ADMINISTRACAO_EXCLUSIVA]);
    const gfin = await porCodigo('GFIN');
    expect(mensagens(await alterar(gfin.id, { permissoes: [{ funcionalidade: 'adm.historico', acoes: ['consultar'] }, { funcionalidade: 'cad.um', acoes: ['consultar'] }] }))).toEqual([
      MENSAGENS_PERFIL.ADMINISTRACAO_EXCLUSIVA,
    ]);
    const auditor = await porCodigo('AUDITOR');
    expect((await exibidas('AUDITOR')).filter((c) => c.startsWith('adm.'))).toEqual(['adm.historico']);
    expect((await alterar(auditor.id, { permissoes: [{ funcionalidade: 'adm.historico', acoes: ['consultar'] }] })).ok).toBe(true);
    expect(await permissoesDoBanco(auditor.id)).toEqual([p('adm.historico', 'consultar')]);
  });

  it('requisição que retira adm.* do Administrador não muda nada nelas; inativar e excluir o Administrador é recusado', async () => {
    const admin = await porCodigo('ADMINISTRADOR');
    const antes = await permissoesDoBanco(admin.id);
    expect(antes).toContain(p('adm.perfis', 'excluir'));
    // A grade mostra as adm.* como fixas e fora das exibidas.
    const grade = await gradePermissoes(ctx, 'ADMINISTRADOR', deps());
    expect(grade[0]?.funcionalidades.find((f) => f.codigo === 'adm.perfis')?.fixas).toEqual(['consultar', 'incluir', 'alterar', 'excluir']);
    const r = await alterar(admin.id, { permissoes: [{ funcionalidade: 'cad.dois', acoes: ['consultar'] }] });
    expect(r.ok).toBe(true);
    expect(await permissoesDoBanco(admin.id)).toEqual([...antes, p('cad.dois', 'consultar')].sort());
    expect(mensagens(await alterar(admin.id, { ativo: false, confirmarInativacao: true }))).toEqual([MENSAGENS_PERFIL.ADMINISTRADOR_INATIVO]);
    expect(mensagens(await excluirPerfil(ctx, admin.id, (await perfil(admin.id)).versao, deps()))).toEqual([MENSAGENS_PERFIL.PADRAO_EXCLUSAO]);
    // Volta ao que era (o resto do arquivo conta com o Administrador sem cad.dois).
    expect((await alterar(admin.id, { permissoes: [] })).ok).toBe(true);
    expect(await permissoesDoBanco(admin.id)).toEqual(antes);
  });

  it('exibidas forjada (omitindo ou incluindo funcionalidade) → conflito, nada gravado (A1)', async () => {
    const id = await criar('Exibidas');
    const atual = await perfil(id);
    const base = await dados(atual.codigo, { nome: 'Exibidas', permissoes: [] });
    const omitindo = { ...base, exibidas: base.exibidas.filter((c) => c !== 'cad.um') };
    const incluindo = { ...base, exibidas: [...base.exibidas, 'adm.usuarios'] };
    for (const e of [omitindo, incluindo]) expect(mensagens(await alterarPerfil(ctx, id, atual.versao, e, deps()))).toEqual([MENSAGEM_CONFLITO]);
    expect(await permissoesDoBanco(id)).toEqual([p('cad.um', 'consultar')]);
  });
});

describe('exclusão (Review Focus 3; RN0072, D-P13-3, D-P13-10, A5, A6)', () => {
  it('perfil da tela sem usuários sai com Histórico; com usuário inativo não sai; padrão nunca sai', async () => {
    const id = await criar('Para Excluir');
    expect((await excluirPerfil(ctx, id, 0, deps())).ok).toBe(true);
    expect(await migrator.perfil.findUnique({ where: { id } })).toBeNull();
    expect(await migrator.perfilPermissao.count({ where: { perfilId: id } })).toBe(0);
    expect(await historico(id)).toEqual([
      ['INSERCAO', 'Perfil Para Excluir cadastrado'],
      ['INSERCAO', 'Funcionalidade Tela cad.um associada ao perfil Para Excluir'],
      ['EXCLUSAO', 'Perfil Para Excluir excluído'],
    ]);
    const comInativo = await criar('Com Inativo');
    await usuarioCom(comInativo, false);
    expect(mensagens(await excluirPerfil(ctx, comInativo, 0, deps()))).toEqual([MENSAGENS_PERFIL.COM_USUARIOS]);
    const gfin = await porCodigo('GFIN');
    expect(mensagens(await excluirPerfil(ctx, gfin.id, gfin.versao, deps()))).toEqual([MENSAGENS_PERFIL.PADRAO_EXCLUSAO]);
    expect(mensagens(await excluirPerfil(ctx, comInativo, 7, deps()))).toEqual([MENSAGEM_CONFLITO]);
  });

  it('o gatilho do banco recusa apagar perfil padrão, mesmo sem a aplicação', async () => {
    const db = new pg.Client({ connectionString: banco.urlApp });
    await db.connect();
    try {
      await expect(db.query(`DELETE FROM perfil WHERE codigo = 'DIREX'`)).rejects.toEqual(expect.objectContaining({ code: '23514' }));
    } finally {
      await db.end();
    }
  });

  it('associação feita durante a exclusão: espera a trava e falha com mensagem; nenhum vínculo para perfil apagado', async () => {
    const id = await criar('Corrida Exclusão');
    const outro = new pg.Client({ connectionString: banco.urlApp });
    await outro.connect();
    try {
      // A exclusão de outra sessão prende a linha do perfil, como o excluirPerfil faz.
      await outro.query('BEGIN');
      await outro.query('SELECT 1 FROM perfil WHERE id = $1 FOR UPDATE', [id]);
      const cadastro = cadastrarUsuario(
        ctx,
        { nome: 'Corrida', email: 'corrida@example.org', login: 'corrida', ativo: true, perfis: [(await perfil(id)).codigo], unidades: [], ccEscopo: null },
        { cliente: app, agora: () => new Date(), enviarEmail: emailFalso().enviarEmail, estrutura: estruturaFinanceiraFalsa() },
      );
      await new Promise((r) => setTimeout(r, 300));
      await outro.query('DELETE FROM perfil_permissao WHERE perfil_id = $1', [id]);
      await outro.query('DELETE FROM perfil WHERE id = $1', [id]);
      await outro.query('COMMIT');
      expect(mensagens(await cadastro)).toEqual([MENSAGENS_USUARIO.PERFIL_EXCLUIDO]);
    } finally {
      await outro.end();
    }
    expect(await migrator.usuarioPerfil.count({ where: { perfilId: id } })).toBe(0);
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'corrida' } })).toBe(0);
  });

  it('exclusão durante uma associação ainda aberta: espera e recusa com a mensagem de usuários', async () => {
    const id = await criar('Corrida Associação');
    const usuario = await usuarioCom((await porCodigo('GFIN')).id);
    const outro = new pg.Client({ connectionString: banco.urlApp });
    await outro.connect();
    try {
      await outro.query('BEGIN');
      await outro.query('INSERT INTO usuario_perfil (usuario_id, perfil_id) VALUES ($1, $2)', [usuario, id]);
      const exclusao = excluirPerfil(ctx, id, 0, deps());
      await new Promise((r) => setTimeout(r, 300));
      await outro.query('COMMIT');
      expect(mensagens(await exclusao)).toEqual([MENSAGENS_PERFIL.COM_USUARIOS]);
    } finally {
      await outro.end();
    }
    expect(await migrator.perfil.findUnique({ where: { id } })).not.toBeNull();
  });
});

describe('sessões e acesso efetivo (Review Focus 4; RN0040, D-P13-6, D-P13-7, A7)', () => {
  it('mudar permissões derruba as sessões dos usuários do perfil, não a de quem salvou; só nome não derruba', async () => {
    const id = await criar('Sessões');
    const usuario = await usuarioCom(id);
    await migrator.usuarioPerfil.create({ data: { usuarioId: ctx.usuarioId, perfilId: id } });
    const [u0, eu0] = [await acesso(usuario), await acesso(ctx.usuarioId)];
    const usuarioVersao = (await migrator.usuario.findUniqueOrThrow({ where: { id: usuario } })).versao;
    expect((await alterar(id, { nome: 'Sessões Renomeado', descricao: 'Só texto' })).ok).toBe(true);
    expect(await acesso(usuario)).toBe(u0);
    expect((await alterar(id, { permissoes: [{ funcionalidade: 'cad.um', acoes: ['consultar', 'incluir'] }] })).ok).toBe(true);
    expect(await acesso(usuario)).toBe(u0 + 1);
    expect(await acesso(ctx.usuarioId)).toBe(eu0);
    // Sem conflito falso na tela de usuários.
    expect((await migrator.usuario.findUniqueOrThrow({ where: { id: usuario } })).versao).toBe(usuarioVersao);
    expect([...(await carregarPermissoes(app, usuario))].sort()).toEqual([p('cad.um', 'consultar'), p('cad.um', 'incluir')]);
    await migrator.usuarioPerfil.delete({ where: { usuarioId_perfilId: { usuarioId: ctx.usuarioId, perfilId: id } } });
  });

  it('permissão em funcionalidade inativa fica e volta ao reativar; RN0082 conta só as ativas; renomear segue possível (A7)', async () => {
    const id = await criar('Inativas', [
      { funcionalidade: 'rel.um', acoes: ['consultar'] },
      { funcionalidade: 'cad.dois', acoes: ['consultar'] },
    ]);
    const usuario = await usuarioCom(id);
    await migrator.modulo.update({ where: { codigo: 'RELATORIOS' }, data: { ativo: false } });
    try {
      expect(await exibidas(null)).not.toContain('rel.um');
      // Tirar a única ativa deixaria o perfil sem funcionalidade ativa (E2).
      expect(mensagens(await alterar(id, { permissoes: [] }))).toEqual([MENSAGENS_PERFIL.SEM_FUNCIONALIDADE]);
      expect((await alterar(id, { permissoes: [{ funcionalidade: 'cad.dois', acoes: ['consultar', 'exportar'] }] })).ok).toBe(true);
      expect(await permissoesDoBanco(id)).toEqual([p('cad.dois', 'consultar'), p('cad.dois', 'exportar'), p('rel.um', 'consultar')]);
      expect([...(await carregarPermissoes(app, usuario))].sort()).toEqual([p('cad.dois', 'consultar'), p('cad.dois', 'exportar')]);
      // A7: um perfil só com funcionalidades inativas continua renomeável.
      await migrator.modulo.update({ where: { codigo: 'RELATORIOS' }, data: { ativo: true } });
      const soRel = await criar('Só Relatório', [{ funcionalidade: 'rel.dois', acoes: ['consultar'] }]);
      await migrator.modulo.update({ where: { codigo: 'RELATORIOS' }, data: { ativo: false } });
      expect((await alterar(soRel, { nome: 'Só Relatório Renomeado' })).ok).toBe(true);
    } finally {
      await migrator.modulo.update({ where: { codigo: 'RELATORIOS' }, data: { ativo: true } });
    }
    expect([...(await carregarPermissoes(app, usuario))].sort()).toEqual([p('cad.dois', 'consultar'), p('cad.dois', 'exportar'), p('rel.um', 'consultar')]);
  });

  it('inativar com usuários ativos pede a confirmação (E3) e não grava; confirmado, grava e derruba as sessões', async () => {
    const id = await criar('Inativar');
    const usuario = await usuarioCom(id);
    const u0 = await acesso(usuario);
    expect(await alterar(id, { ativo: false })).toEqual({ ok: true, valor: { confirmar: MENSAGENS_PERFIL.CONFIRMAR_INATIVACAO } });
    expect(await perfil(id)).toMatchObject({ ativo: true, versao: 0 });
    expect(await historico(id)).toHaveLength(2);
    expect((await alterar(id, { ativo: false, confirmarInativacao: true })).ok).toBe(true);
    expect(await perfil(id)).toMatchObject({ ativo: false, versao: 1 });
    expect(await acesso(usuario)).toBe(u0 + 1);
    expect([...(await carregarPermissoes(app, usuario))]).toEqual([]);
    expect((await historico(id)).at(-1)).toEqual(['ALTERACAO', 'Perfil Inativar inativado']);
    // Reativar não pede confirmação.
    expect((await alterar(id, { ativo: true })).ok).toBe(true);
    expect(await perfil(id)).toMatchObject({ ativo: true });
  });

  it('perfil da tela com lançamento em pacotes: o usuário fica sem CC de escopo (C25, A3)', async () => {
    const id = await criar('Lança Pacotes', [{ funcionalidade: 'orc.pacotes', acoes: ['consultar', 'incluir'] }]);
    const usuario = await usuarioCom(id);
    expect(await migrator.$transaction((tx) => obterEscopoCentroCusto(tx, usuario))).toBeNull();
  });
});

describe('concorrência e Histórico (Review Focus 5; RNF0002, RN0080, RN0081, D-P13-8)', () => {
  it('dois salvamentos com a mesma versão: um grava, o outro recebe o conflito', async () => {
    const id = await criar('Concorrência');
    const [a, b] = await Promise.all([alterar(id, { descricao: 'A' }, 0), alterar(id, { descricao: 'B' }, 0)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([...mensagens(a), ...mensagens(b)]).toEqual([MENSAGEM_CONFLITO]);
    expect((await perfil(id)).versao).toBe(1);
  });

  it('uma entrada por associação, retirada e mudança de ações; salvar sem mudança não grava', async () => {
    const id = await criar('Histórico', [
      { funcionalidade: 'cad.um', acoes: ['consultar'] },
      { funcionalidade: 'cad.dois', acoes: ['consultar'] },
    ]);
    expect(
      (
        await alterar(id, {
          permissoes: [
            { funcionalidade: 'cad.um', acoes: ['consultar', 'alterar'] },
            { funcionalidade: 'rel.um', acoes: ['consultar'] },
          ],
        })
      ).ok,
    ).toBe(true);
    expect((await historico(id)).slice(3)).toEqual([
      ['ALTERACAO', 'Perfil Histórico alterado'],
      ['INSERCAO', 'Funcionalidade Tela rel.um associada ao perfil Histórico'],
      ['EXCLUSAO', 'Funcionalidade Tela cad.dois retirada do perfil Histórico'],
      ['ALTERACAO', 'Ações da funcionalidade Tela cad.um no perfil Histórico alteradas'],
    ]);
    const principal = await migrator.historicoOperacao.findFirstOrThrow({ where: { registroId: id, descricao: 'Perfil Histórico alterado' } });
    expect(principal.depois).toMatchObject({ nome: 'Histórico', ativo: true, permissoes: { 'cad.um': ['consultar', 'alterar'], 'rel.um': ['consultar'] } });
    const versao = (await perfil(id)).versao;
    expect((await alterar(id, {})).ok).toBe(true);
    expect((await perfil(id)).versao).toBe(versao);
    expect(await historico(id)).toHaveLength(7);
  });

  it('falha no Histórico desfaz perfil e permissões juntos', async () => {
    const id = await criar('Atômico');
    const quebrado = { ...ctx, ip: 'nao-e-ip' };
    await expect(alterar(id, { nome: 'Atômico 2', permissoes: [{ funcionalidade: 'cad.dois', acoes: ['consultar'] }] }, undefined, quebrado)).rejects.toThrow();
    expect(await perfil(id)).toMatchObject({ nome: 'Atômico', versao: 0 });
    expect(await permissoesDoBanco(id)).toEqual([p('cad.um', 'consultar')]);
  });
});
