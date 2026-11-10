import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { estruturaFinanceiraFalsa } from '@/modules/cad/servidor';
import { emailFalso } from '@/modules/ger';
import type { ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_EXCECAO } from '../domain/excecao-usuario';
import { MENSAGENS_USUARIO } from '../domain/usuario';
import { seedAdm } from '../infrastructure/seed';
import type { DeclaracaoFuncionalidade } from './catalogo';
import { consultarHistorico } from './historico';
import { instalarFuncionalidades } from './instalar-funcionalidades';
import { carregarPermissoes } from './login';
import { alterarUsuario, cadastrarUsuario, listarOpcoesUsuario, obterUsuario } from './usuarios';

// Exceções de permissão por usuário (US-039; EP085 UC02.12 A2, UC02.13 A4–A6, REQ0080, REQ0081;
// plano do P10, D-P10-1 a D-P10-5, Review Focus 1 a 3, ajustes A1, M1, M2, B2 e B3 da revisão).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ctx: ContextoRequisicao;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
const deps = () => ({ cliente: app, agora: () => AGORA, enviarEmail: emailFalso().enviarEmail, estrutura: estruturaFinanceiraFalsa() });

// Funcionalidades só do teste, fora da Administração. Orçamentista: cad.um e cad.dois; GFIN: cad.um
// e rel.um; Auditor: cad.um (e a seed do adm dá a ele adm.historico).
const item = (codigo: string, modulo: DeclaracaoFuncionalidade['modulo'], ordem: number, perfisPadrao: DeclaracaoFuncionalidade['perfisPadrao']) => ({
  codigo,
  modulo,
  grupo: 'Grupo do teste',
  nome: `Tela ${codigo}`,
  rota: `/${codigo.replace('.', '/')}`,
  ordem,
  acoes: ['consultar', 'exportar'],
  perfisPadrao,
}) satisfies DeclaracaoFuncionalidade;

const dados = (login: string, extra: Record<string, unknown> = {}) => ({
  nome: `Nome ${login}`,
  email: `${login}@example.org`,
  login,
  ativo: true,
  perfis: ['ORCAMENTISTA'],
  unidades: [] as string[],
  ccEscopo: null,
  ...extra,
});
const ex = (perfil: string, funcionalidade: string) => ({ perfil, funcionalidade });

async function cadastrar(login: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await cadastrarUsuario(ctx, dados(login, extra), deps());
  if (!r.ok) throw new Error(`cadastro falhou: ${JSON.stringify(r.erros)}`);
  return r.valor.id;
}
const usuario = (id: string) => migrator.usuario.findUniqueOrThrow({ where: { id } });
const excecoes = async (usuarioId: string) =>
  (await migrator.usuarioExcecao.findMany({ where: { usuarioId }, include: { usuarioPerfil: { include: { perfil: true } } } }))
    .map((e) => `${e.usuarioPerfil.perfil.codigo}:${e.funcionalidadeCodigo}`)
    .sort();
const historico = async (registroId: string) =>
  (await migrator.historicoOperacao.findMany({ where: { registroId }, orderBy: { id: 'asc' } })).map((x) => [x.tipoOperacao, x.descricao]);
// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: a chave sai daqui.
const consulta = (funcionalidade: string) => [funcionalidade, 'consultar'].join(':');
const permissoes = (id: string, filtro?: { modulo?: string }) => carregarPermissoes(app, id, filtro);

async function alterar(id: string, extra: Record<string, unknown>, login = 'x') {
  const atual = await usuario(id);
  return alterarUsuario(ctx, id, atual.versao, dados(login, { nome: atual.nome, email: atual.email, ...extra }), deps());
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  await migrator.$transaction((tx) =>
    instalarFuncionalidades(tx, [
      item('cad.um', 'CADASTROS', 1, { ORCAMENTISTA: ['consultar', 'exportar'], GFIN: ['consultar'], AUDITOR: ['consultar'] }),
      item('cad.dois', 'CADASTROS', 2, { ORCAMENTISTA: ['consultar'] }),
      item('rel.um', 'RELATORIOS', 1, { GFIN: ['consultar'] }),
    ]),
  );
  const raiz = await migrator.usuario.create({ data: { nome: 'Raiz', email: 'raiz@example.org', login: 'raiz', loginNormalizado: 'raiz', senhaHash: 'x' } });
  ctx = {
    usuarioId: raiz.id,
    usuarioRotulo: 'raiz',
    sessaoUid: 's-raiz',
    ip: '203.0.113.1',
    permissoes: new Set(['adm.usuarios:consultar', 'adm.usuarios:incluir', 'adm.usuarios:alterar']),
  };
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

beforeEach(async () => {
  await migrator.funcionalidade.updateMany({ where: { codigo: { in: ['cad.um', 'cad.dois', 'rel.um'] } }, data: { ativo: true } });
});

describe('carregarPermissoes com exceção (D-P10-3, Review Focus 1)', () => {
  it('exceção num perfil só: a funcionalidade continua pelo outro perfil; nos dois, sai', async () => {
    const id = await cadastrar('dois.perfis', { perfis: ['ORCAMENTISTA', 'GFIN'] });
    expect((await alterar(id, { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes: [ex('ORCAMENTISTA', 'cad.um')] })).ok).toBe(true);
    let p = await permissoes(id);
    expect(p.has(consulta('cad.um'))).toBe(true); // pelo GFIN
    expect(p.has(['cad.um', 'exportar'].join(':'))).toBe(false); // só o Orçamentista exporta
    expect(p.has(consulta('cad.dois'))).toBe(true);

    expect((await alterar(id, { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes: [ex('ORCAMENTISTA', 'cad.um'), ex('GFIN', 'cad.um')] })).ok).toBe(true);
    p = await permissoes(id);
    expect(p.has(consulta('cad.um'))).toBe(false);
    expect(p.has(consulta('cad.dois'))).toBe(true);
    expect(p.has(consulta('rel.um'))).toBe(true);
  });

  it('com o filtro de módulo do sistema inativo, a exceção continua valendo', async () => {
    const id = await cadastrar('filtro.modulo', { excecoes: [ex('ORCAMENTISTA', 'cad.um')] });
    expect([...(await permissoes(id, { modulo: 'CADASTROS' }))].sort()).toEqual([consulta('cad.dois')]);
    expect([...(await permissoes(id, { modulo: 'RELATORIOS' }))]).toEqual([]);
  });

  it('a exceção também esconde o Histórico daquela funcionalidade (RN0099, ajuste B2)', async () => {
    const id = await cadastrar('aud.excecao', { perfis: ['AUDITOR'] });
    const auditor = { ...ctx, usuarioId: id, usuarioRotulo: 'aud.excecao', permissoes: new Set(['adm.historico:consultar']) };
    await migrator.$executeRaw`INSERT INTO historico_operacao (ocorrido_em, usuario_rotulo, funcionalidade, tipo_operacao, descricao)
      VALUES (${new Date('2026-10-10T12:00:00Z')}, 'alguém', 'cad.um', 'CONSULTA'::"TipoOperacao", 'consulta em cad.um')`;
    const funcionalidades = async () => {
      const r = await consultarHistorico(auditor, { de: new Date('2026-10-01T00:00:00Z'), ate: new Date('2026-10-31T00:00:00Z'), pagina: 1 }, { cliente: app });
      return r.ok ? r.valor.linhas.map((l) => l.funcionalidade) : r;
    };
    expect(await funcionalidades()).toEqual(['cad.um']);
    expect((await alterar(id, { perfis: ['AUDITOR'], excecoes: [ex('AUDITOR', 'cad.um')] })).ok).toBe(true);
    expect(await funcionalidades()).toEqual([]);
  });
});

describe('alterarUsuario com exceções (UC02.13 A4–A6)', () => {
  it('retirar e devolver só a exceção: acessoVersao sobe (RN0040), Histórico por exceção (D-P10-5), antes/depois com as exceções', async () => {
    const id = await cadastrar('so.excecao');
    const antes = await usuario(id);
    const desde = (await historico(id)).length;
    expect(await alterar(id, { excecoes: [ex('ORCAMENTISTA', 'cad.um')] })).toEqual({ ok: true, valor: undefined });
    const meio = await usuario(id);
    expect(meio.acessoVersao).toBe(antes.acessoVersao + 1);
    expect(meio.versao).toBe(antes.versao + 1);
    expect(await excecoes(id)).toEqual(['ORCAMENTISTA:cad.um']);
    const h = await migrator.historicoOperacao.findMany({ where: { registroId: id }, orderBy: { id: 'asc' }, skip: desde });
    expect(h.map((x) => [x.tipoOperacao, x.descricao])).toEqual([
      ['ALTERACAO', 'Alterou o usuário Nome so.excecao'],
      ['INSERCAO', 'Funcionalidade Tela cad.um do perfil Orçamentista retirada do usuário Nome so.excecao'],
    ]);
    expect(JSON.stringify(h[0]!.depois)).toContain('"excecoes":["ORCAMENTISTA:cad.um"]');
    expect(JSON.stringify(h[0]!.antes)).toContain('"excecoes":[]');

    // A5: marcar de novo devolve a funcionalidade.
    expect((await alterar(id, { excecoes: [] })).ok).toBe(true);
    expect((await usuario(id)).acessoVersao).toBe(meio.acessoVersao + 1);
    expect(await excecoes(id)).toEqual([]);
    expect((await historico(id)).at(-1)).toEqual(['EXCLUSAO', 'Funcionalidade Tela cad.um do perfil Orçamentista devolvida ao usuário Nome so.excecao']);
  });

  it('Salvar com as mesmas exceções: não grava nem audita', async () => {
    const id = await cadastrar('mesmas', { excecoes: [ex('ORCAMENTISTA', 'cad.um')] });
    const antes = await usuario(id);
    const desde = (await historico(id)).length;
    expect(await alterar(id, { excecoes: [ex('ORCAMENTISTA', 'cad.um')] })).toEqual({ ok: true, valor: undefined });
    expect(await usuario(id)).toEqual(antes);
    expect(await historico(id)).toHaveLength(desde);
  });

  it('recusas: funcionalidade fora do perfil, perfil não associado, Administração (A1); nada gravado', async () => {
    const id = await cadastrar('recusas');
    const antes = await usuario(id);
    const erro = (mensagem: string) => ({ ok: false, erros: [{ campo: 'excecoes', mensagem }] });
    expect(await alterar(id, { excecoes: [ex('ORCAMENTISTA', 'rel.um')] })).toEqual(erro(MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL));
    expect(await alterar(id, { excecoes: [ex('ORCAMENTISTA', 'nao.existe')] })).toEqual(erro(MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL));
    expect(await alterar(id, { excecoes: [ex('GFIN', 'rel.um')] })).toEqual(erro(MENSAGENS_EXCECAO.PERFIL_NAO_ASSOCIADO));
    expect(await alterar(id, { perfis: ['ORCAMENTISTA', 'ADMINISTRADOR'], excecoes: [ex('ADMINISTRADOR', 'adm.usuarios')] })).toEqual(
      erro(MENSAGENS_EXCECAO.ADMINISTRACAO),
    );
    expect(await usuario(id)).toEqual(antes);
    expect(await excecoes(id)).toEqual([]);
  });

  it('todas as funcionalidades do perfil desmarcadas: o perfil sai (REQ0081); sem perfil que sobre, E1 da RN0079', async () => {
    const id = await cadastrar('req81', { perfis: ['ORCAMENTISTA', 'GFIN'] });
    const tudo = [ex('ORCAMENTISTA', 'cad.um'), ex('ORCAMENTISTA', 'cad.dois')];
    expect((await alterar(id, { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes: tudo })).ok).toBe(true);
    const perfis = await migrator.usuarioPerfil.findMany({ where: { usuarioId: id }, include: { perfil: true } });
    expect(perfis.map((p) => p.perfil.codigo)).toEqual(['GFIN']);
    expect(await excecoes(id)).toEqual([]);
    expect((await historico(id)).at(-1)).toEqual(['EXCLUSAO', 'Perfil Orçamentista desassociado do usuário Nome req81']);

    const so = await cadastrar('req81.so');
    const antes = await usuario(so);
    expect(await alterar(so, { excecoes: tudo })).toEqual({ ok: false, erros: [{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_OBRIGATORIO }] });
    expect(await usuario(so)).toEqual(antes);
  });

  it('retirar o perfil apaga as exceções dele, sem Histórico próprio (B3); associá-lo de novo começa sem exceção (Review Focus 2)', async () => {
    const id = await cadastrar('orfa', { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes: [ex('ORCAMENTISTA', 'cad.dois')] });
    const desde = (await historico(id)).length;
    expect((await alterar(id, { perfis: ['GFIN'] })).ok).toBe(true);
    expect(await excecoes(id)).toEqual([]);
    expect((await historico(id)).slice(desde).map(([, d]) => d)).toEqual([
      'Alterou o usuário Nome orfa',
      'Perfil Orçamentista desassociado do usuário Nome orfa',
    ]);
    expect((await alterar(id, { perfis: ['ORCAMENTISTA', 'GFIN'] })).ok).toBe(true);
    expect(await excecoes(id)).toEqual([]);
    expect((await permissoes(id)).has(consulta('cad.dois'))).toBe(true);
  });

  it('exceção numa funcionalidade que saiu do painel (inativa) é mantida pelo Salvar (ajuste M2)', async () => {
    const id = await cadastrar('inativa', { excecoes: [ex('ORCAMENTISTA', 'cad.dois')] });
    await migrator.funcionalidade.update({ where: { codigo: 'cad.dois' }, data: { ativo: false } });
    const opcoes = await listarOpcoesUsuario(ctx, id, deps());
    expect(opcoes.perfis.find((p) => p.codigo === 'ORCAMENTISTA')?.funcionalidades.map((f) => f.codigo)).toEqual(['cad.um']);
    expect(await alterar(id, { excecoes: [] })).toEqual({ ok: true, valor: undefined });
    expect(await excecoes(id)).toEqual(['ORCAMENTISTA:cad.dois']);
    // Inativa, também não aceita exceção nova.
    expect(await alterar(id, { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes: [ex('ORCAMENTISTA', 'cad.dois')] })).toEqual({
      ok: false,
      erros: [{ campo: 'excecoes', mensagem: MENSAGENS_EXCECAO.FUNCIONALIDADE_FORA_DO_PERFIL }],
    });
  });

  it('versão velha: erro de concorrência, nenhuma exceção gravada', async () => {
    const id = await cadastrar('velha');
    const { versao } = await usuario(id);
    expect((await alterarUsuario(ctx, id, versao, { ...dados('velha'), nome: 'Outro' }, deps())).ok).toBe(true);
    expect(await alterarUsuario(ctx, id, versao, dados('velha', { excecoes: [ex('ORCAMENTISTA', 'cad.um')] }), deps())).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: MENSAGENS_USUARIO.ALTERADO }],
    });
    expect(await excecoes(id)).toEqual([]);
  });
});

describe('cadastrarUsuario com exceções (UC02.12 A2)', () => {
  it('grava a exceção depois do vínculo com o perfil, audita a retirada e a permissão sai', async () => {
    const id = await cadastrar('novo.excecao', { excecoes: [ex('ORCAMENTISTA', 'cad.um')] });
    expect(await excecoes(id)).toEqual(['ORCAMENTISTA:cad.um']);
    expect(await historico(id)).toEqual([
      ['INSERCAO', 'Cadastrou o usuário Nome novo.excecao'],
      ['INSERCAO', 'Perfil Orçamentista associado ao usuário Nome novo.excecao'],
      ['INSERCAO', 'Funcionalidade Tela cad.um do perfil Orçamentista retirada do usuário Nome novo.excecao'],
    ]);
    expect((await permissoes(id)).has(consulta('cad.um'))).toBe(false);
  });

  it('recusa a Administração e a funcionalidade fora do perfil, sem gravar; tudo desmarcado → E1 da RN0079', async () => {
    expect(await cadastrarUsuario(ctx, dados('novo.adm', { perfis: ['ADMINISTRADOR'], excecoes: [ex('ADMINISTRADOR', 'adm.historico')] }), deps())).toEqual({
      ok: false,
      erros: [{ campo: 'excecoes', mensagem: MENSAGENS_EXCECAO.ADMINISTRACAO }],
    });
    expect(await cadastrarUsuario(ctx, dados('novo.tudo', { excecoes: [ex('ORCAMENTISTA', 'cad.um'), ex('ORCAMENTISTA', 'cad.dois')] }), deps())).toEqual({
      ok: false,
      erros: [{ campo: 'perfis', mensagem: MENSAGENS_USUARIO.PERFIL_OBRIGATORIO }],
    });
    expect(await migrator.usuario.count({ where: { loginNormalizado: { in: ['novo.adm', 'novo.tudo'] } } })).toBe(0);
  });
});

describe('consulta das exceções', () => {
  it('obterUsuario traz as exceções; as opções trazem, por perfil, as retiráveis e as fixas da Administração', async () => {
    const id = await cadastrar('consulta.ex', { perfis: ['ORCAMENTISTA', 'GFIN'], excecoes: [ex('GFIN', 'rel.um')] });
    expect((await obterUsuario(ctx, id, deps()))?.excecoes).toEqual([ex('GFIN', 'rel.um')]);
    const opcoes = await listarOpcoesUsuario(ctx, id, deps());
    const perfil = (codigo: string) => opcoes.perfis.find((p) => p.codigo === codigo)!;
    expect(perfil('ORCAMENTISTA').funcionalidades).toEqual([
      { codigo: 'cad.um', nome: 'Tela cad.um' },
      { codigo: 'cad.dois', nome: 'Tela cad.dois' },
    ]);
    expect(perfil('ORCAMENTISTA').fixas).toEqual([]);
    expect(perfil('ADMINISTRADOR').fixas.map((f) => f.codigo)).toContain('adm.usuarios');
    expect(perfil('ADMINISTRADOR').funcionalidades.some((f) => f.codigo.startsWith('adm.'))).toBe(false);
  });
});
