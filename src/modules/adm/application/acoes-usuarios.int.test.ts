import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_USUARIO } from '../domain/usuario';
import { seedAdm } from '../infrastructure/seed';

// E-mail falso no lugar do outbox real: o envio em si é do C4 (frente B).
const correio = vi.hoisted(() => ({ enviados: [] as { modelo: string; destinatario: { email: string } }[] }));
vi.mock('@/modules/ger', async (original) => {
  const real = await original<typeof import('@/modules/ger')>();
  const falso = real.emailFalso();
  correio.enviados = falso.enviados as typeof correio.enviados;
  return { ...real, enviarEmail: falso.enviarEmail };
});

const { alterar, cadastrar, desbloquear, gerarNovaSenha } = await import('./acoes-usuarios');
const { listarOpcoesUsuario } = await import('./usuarios');

// Ações de usuário (US-038 parte 2) pela definirAcao, com o FormData do Formulario do C3.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let admin: ContextoRequisicao;
let orcamentista: ContextoRequisicao;
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
let unidade: string;
let unidadeInativa: string;

const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

function formulario(campos: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

const campos = (login: string, extra: Record<string, string | string[]> = {}) => ({
  nome: `Nome ${login}`,
  email: `${login}@example.org`,
  login,
  ativo: 'on',
  perfis: ['ORCAMENTISTA', 'GFIN'],
  unidades: [unidade],
  ccEscopo: '',
  ...extra,
});

// O Next sinaliza redirect lançando um erro com digest próprio.
const digest = (p: Promise<unknown>) => p.then((r) => JSON.stringify(r), (e: { digest?: string }) => e.digest ?? String(e));

const porLogin = (login: string) =>
  migrator.usuario.findUniqueOrThrow({ where: { loginNormalizado: login }, include: { perfis: { include: { perfil: true } }, unidades: true } });

async function criarDireto(login: string, extra: { bloqueado?: boolean } = {}): Promise<string> {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'ORCAMENTISTA' } });
  const u = await migrator.usuario.create({
    data: {
      nome: `Nome ${login}`,
      email: `${login}@example.org`,
      login,
      loginNormalizado: login,
      senhaHash: 'x',
      trocaSenhaObrigatoria: false,
      tentativasFalhas: extra.bloqueado ? 5 : 0,
      bloqueado: extra.bloqueado ?? false,
      perfis: { create: { perfilId: p.id } },
    },
  });
  return u.id;
}

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const permissoesUsuarios = (...acoes: string[]) => acoes.map((a) => `adm.usuarios:${a}`);

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  global_.__sgoPrisma = app; // as ações usam o prisma padrão (sgo_app)
  await executarSeeds(migrator, [seedAdm]);
  const raiz = await criarDireto('raiz');
  admin = {
    usuarioId: raiz.toString(),
    usuarioRotulo: 'raiz',
    sessaoUid: 's-raiz',
    ip: '203.0.113.1',
    permissoes: new Set(permissoesUsuarios('consultar', 'incluir', 'alterar')),
  };
  orcamentista = { ...admin, usuarioId: await criarDireto('orc'), usuarioRotulo: 'orc', permissoes: new Set(['aut.tela_principal:consultar']) };
  unidade = (await migrator.unidade.create({ data: { codigo: 'TP-1', nome: 'TP 1' } })).id;
  unidadeInativa = (await migrator.unidade.create({ data: { codigo: 'TP-9', nome: 'TP 9', ativo: false } })).id;
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    delete global_.__sgoPrisma;
    await banco?.parar();
  }
});

beforeEach(() => {
  contexto = admin;
  negacoes = [];
  correio.enviados.length = 0;
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});


describe('cadastrar (UC02.12)', () => {
  it('FormData com getAll de perfis e TPs: cria, envia a senha e volta à listagem com o aviso', async () => {
    expect(await digest(cadastrar(formulario(campos('ana'))))).toMatch(/^NEXT_REDIRECT;.*;\/adm\/usuarios\?aviso=cadastrado;/);
    const u = await porLogin('ana');
    expect(u).toMatchObject({ nome: 'Nome ana', ativo: true, ccEscopo: null, trocaSenhaObrigatoria: true });
    expect(u.perfis.map((p) => p.perfil.codigo).sort()).toEqual(['GFIN', 'ORCAMENTISTA']);
    expect(u.unidades.map((x) => x.unidadeId)).toEqual([unidade]);
    expect(correio.enviados).toMatchObject([{ modelo: 'usuario.senha_inicial', destinatario: { email: 'ana@example.org' } }]);
  });

  it('status desmarcado grava inativo', async () => {
    const semAtivo: Record<string, string | string[]> = campos('bia');
    delete semAtivo.ativo;
    await digest(cadastrar(formulario(semAtivo)));
    expect((await porLogin('bia')).ativo).toBe(false);
  });

  it('dados inválidos: Resultado com erro por campo, sem redirecionar nem gravar', async () => {
    const r = await cadastrar(formulario(campos('ab', { perfis: [] })));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? [] : r.erros.map((e) => e.campo)).toContain('perfis');
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'ab' } })).toBe(0);
    expect(correio.enviados).toEqual([]);
  });

  it('login repetido: mensagem do RN0065', async () => {
    const r = await cadastrar(formulario(campos('ana')));
    expect(r).toMatchObject({ ok: false, erros: [{ mensagem: MENSAGENS_USUARIO.LOGIN_DUPLICADO }] });
  });
});

describe('alterar (UC02.13)', () => {
  it('grava com a versão do formulário, ignora o login enviado e volta à listagem', async () => {
    const u = await porLogin('ana');
    const f = formulario({ ...campos('outro.login', { nome: 'Ana Alterada', email: 'ana@example.org', perfis: ['ORCAMENTISTA'] }), id: u.id, versao: String(u.versao) });
    expect(await digest(alterar(f))).toMatch(/^NEXT_REDIRECT;.*;\/adm\/usuarios\?aviso=alterado;/);
    const depois = await porLogin('ana');
    expect(depois).toMatchObject({ nome: 'Ana Alterada', login: 'ana', versao: u.versao + 1 });
    expect(depois.perfis.map((p) => p.perfil.codigo)).toEqual(['ORCAMENTISTA']);
  });

  it('versão antiga: mensagem de registro alterado por outro usuário', async () => {
    const u = await porLogin('ana');
    const r = await alterar(formulario({ ...campos('ana'), id: u.id, versao: String(u.versao - 1) }));
    expect(r).toMatchObject({ ok: false, erros: [{ mensagem: MENSAGENS_USUARIO.ALTERADO }] });
  });

  it('id inexistente: Usuário não encontrado', async () => {
    const r = await alterar(formulario({ ...campos('ana'), id: '00000000-0000-4000-8000-000000000000', versao: '0' }));
    expect(r).toMatchObject({ ok: false, erros: [{ mensagem: MENSAGENS_USUARIO.INEXISTENTE }] });
  });

  it('perfil e TP inativos já vinculados: o Salvar mantém os vínculos', async () => {
    const id = await criarDireto('mantem');
    const gfin = await migrator.perfil.findUniqueOrThrow({ where: { codigo: 'GFIN' } });
    await migrator.usuarioPerfil.create({ data: { usuarioId: id, perfilId: gfin.id } });
    await migrator.usuarioUnidade.create({ data: { usuarioId: id, unidadeId: unidadeInativa } });
    // O catálogo de perfis é fixo (US-037 fora da trilha): o inativo é um dos oito, desativado.
    await migrator.perfil.update({ where: { id: gfin.id }, data: { ativo: false } });
    try {
      const u = await porLogin('mantem');
      const dadosForm = campos('mantem', { nome: 'Mantém Vínculos', perfis: ['ORCAMENTISTA', 'GFIN'], unidades: [unidadeInativa] });
      expect(await digest(alterar(formulario({ ...dadosForm, id, versao: String(u.versao) })))).toMatch(/aviso=alterado;/);
      const depois = await porLogin('mantem');
      expect(depois.nome).toBe('Mantém Vínculos');
      expect(depois.perfis.map((p) => p.perfil.codigo).sort()).toEqual(['GFIN', 'ORCAMENTISTA']);
      expect(depois.unidades.map((x) => x.unidadeId)).toEqual([unidadeInativa]);
    } finally {
      await migrator.perfil.update({ where: { id: gfin.id }, data: { ativo: true } });
    }
  });

  it('TP inativo enviado no formulário: erro de unidade', async () => {
    const u = await porLogin('ana');
    const r = await alterar(formulario({ ...campos('ana', { unidades: [unidadeInativa] }), id: u.id, versao: String(u.versao) }));
    expect(r).toMatchObject({ ok: false, erros: [{ campo: 'unidades', mensagem: MENSAGENS_USUARIO.UNIDADE_INVALIDA }] });
  });
});

describe('resetarSenha e desbloquear (UC02.13 A2, A3)', () => {
  it('reset: Resultado ok (o formulário segue aberto) e a senha vai por e-mail', async () => {
    const u = await porLogin('ana');
    expect(await gerarNovaSenha(formulario({ id: u.id }))).toEqual({ ok: true, valor: undefined });
    expect(correio.enviados).toMatchObject([{ modelo: 'usuario.senha_redefinida' }]);
  });

  it('desbloqueio de usuário bloqueado e ativo: volta à listagem com o aviso', async () => {
    const id = await criarDireto('bloq', { bloqueado: true });
    expect(await digest(desbloquear(formulario({ id })))).toMatch(/^NEXT_REDIRECT;.*;\/adm\/usuarios\?aviso=desbloqueado;/);
    expect(await migrator.usuario.findUniqueOrThrow({ where: { id } })).toMatchObject({ bloqueado: false, tentativasFalhas: 0 });
  });

  it('desbloqueio de quem não está bloqueado: mensagem do RN0063', async () => {
    const u = await porLogin('ana');
    expect(await desbloquear(formulario({ id: u.id }))).toMatchObject({ ok: false, erros: [{ mensagem: MENSAGENS_USUARIO.DESBLOQUEIO_INATIVO }] });
  });
});

describe('sem permissão', () => {
  it('as quatro ações devolvem 403 sem gravar nem enviar e-mail', async () => {
    contexto = orcamentista;
    const u = await porLogin('ana');
    const antes = await migrator.usuario.findUniqueOrThrow({ where: { id: u.id } });
    for (const r of [
      await cadastrar(formulario(campos('intruso'))),
      await alterar(formulario({ ...campos('ana', { nome: 'Invadido' }), id: u.id, versao: String(u.versao) })),
      await gerarNovaSenha(formulario({ id: u.id })),
      await desbloquear(formulario({ id: u.id })),
    ]) {
      expect(r).toMatchObject({ ok: false, status: 403 });
    }
    expect(await migrator.usuario.count({ where: { loginNormalizado: 'intruso' } })).toBe(0);
    expect(await migrator.usuario.findUniqueOrThrow({ where: { id: u.id } })).toEqual(antes);
    expect(correio.enviados).toEqual([]);
    // A janela de negações audita uma vez por usuário, funcionalidade e ação: incluir e alterar.
    expect(negacoes).toHaveLength(2);
    expect(negacoes.every((n) => n.funcionalidade === 'adm.usuarios')).toBe(true);
  });

  // Cada ação exige a ação certa: quem só consulta não grava nada; quem inclui não altera.
  it.each([
    ['só consultar', permissoesUsuarios('consultar'), ['cadastrar', 'alterar', 'gerarNovaSenha', 'desbloquear']],
    ['consultar e incluir', permissoesUsuarios('consultar', 'incluir'), ['alterar', 'gerarNovaSenha', 'desbloquear']],
    ['consultar e alterar', permissoesUsuarios('consultar', 'alterar'), ['cadastrar']],
  ])('%s: 403 nas ações sem a permissão', async (_nome, permissoes, negadas) => {
    contexto = { ...admin, permissoes: new Set(permissoes) };
    const u = await porLogin('ana');
    const chamadas: Record<string, () => Promise<{ ok: boolean }>> = {
      cadastrar: () => cadastrar(formulario(campos('negado'))),
      alterar: () => alterar(formulario({ ...campos('ana'), id: u.id, versao: String(u.versao) })),
      gerarNovaSenha: () => gerarNovaSenha(formulario({ id: u.id })),
      desbloquear: () => desbloquear(formulario({ id: u.id })),
    };
    for (const nome of negadas) expect(await chamadas[nome]!(), nome).toMatchObject({ ok: false, status: 403 });
    // Uma negação auditada por ação distinta (a janela suprime as repetidas).
    expect(negacoes).toHaveLength(new Set(negadas.map((n) => (n === 'cadastrar' ? 'incluir' : 'alterar'))).size);
  });
});

describe('listarOpcoesUsuario', () => {
  it('perfis e TPs ativos; inativos só se já vinculados ao usuário', async () => {
    const semUsuario = await listarOpcoesUsuario(admin);
    expect(semUsuario.unidades).toEqual([{ id: unidade, nome: 'TP 1', ativo: true }]);
    expect(semUsuario.perfis.every((p) => p.ativo)).toBe(true);
    expect(semUsuario.perfis.map((p) => p.codigo)).toContain('ADMINISTRADOR');

    const id = await criarDireto('vinc');
    await migrator.usuarioUnidade.create({ data: { usuarioId: id, unidadeId: unidadeInativa } });
    const comVinculo = await listarOpcoesUsuario(admin, id);
    expect(comVinculo.unidades).toContainEqual({ id: unidadeInativa, nome: 'TP 9', ativo: false });
  });

  it('sem permissão de consultar: ErroPermissao', async () => {
    await expect(listarOpcoesUsuario(orcamentista)).rejects.toMatchObject({ name: 'ErroPermissao' });
  });
});
