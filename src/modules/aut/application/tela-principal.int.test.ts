import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSenha, instalarFuncionalidades, seedAdm, type DeclaracaoFuncionalidade } from '@/modules/adm';
import { seedOrc } from '@/modules/orc';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { autenticar } from './autenticar';
import { criarProvedorContexto } from './provedor-contexto';
import { carregarTelaPrincipal, validarTrocaUnidade } from './tela-principal';

// Tela principal (US-031): menu do catálogo ativo, unidades do usuário e unidade ativa.
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
const SENHA = `Certa${Date.now()}x`;
const AGORA = new Date('2026-11-11T12:00:00.000Z');
let unidades: { a: string; b: string; inativa: string };

async function logado(login: string, perfil: string, unidadesDoUsuario: string[], cookieUnidade?: string, trocaSenhaObrigatoria = false): Promise<ContextoRequisicao> {
  const p = await migrator.perfil.findUniqueOrThrow({ where: { codigo: perfil } });
  await migrator.usuario.create({
    data: {
      nome: `Nome ${login}`,
      email: `${login}@exemplo.org`,
      login,
      loginNormalizado: login,
      senhaHash: await hashSenha(SENHA),
      trocaSenhaObrigatoria,
      perfis: { create: { perfilId: p.id } },
      unidades: { create: unidadesDoUsuario.map((unidadeId) => ({ unidadeId })) },
    },
  });
  const r = await autenticar({ login, senha: SENHA, ip: null }, { cliente: app, agora: () => AGORA });
  if (!r.ok) throw new Error('login falhou');
  const ctx = await criarProvedorContexto({
    cliente: app,
    agora: () => AGORA,
    lerCookie: async (nome) => (nome === 'sgo_unidade' ? cookieUnidade : r.token),
    lerCabecalho: async () => null,
  }).obter();
  if (!ctx) throw new Error('sem contexto');
  return ctx;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  await executarSeeds(migrator, [seedAdm]);
  const criar = (codigo: string, ativo = true) => migrator.unidade.create({ data: { codigo, nome: `TP ${codigo}`, ativo } }).then((u) => u.id);
  unidades = { a: await criar('TP-A'), b: await criar('TP-B'), inativa: await criar('TP-X', false) };
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

describe('carregarTelaPrincipal', () => {
  it('administrador: menu com Usuários, nome, data do acesso e unidades ativas', async () => {
    const ctx = await logado('ana', 'ADMINISTRADOR', [unidades.a, unidades.b, unidades.inativa]);
    const t = await carregarTelaPrincipal(ctx, { cliente: app });
    expect(t.menu.map((m) => m.codigo)).toEqual(['ADMINISTRACAO']);
    // Módulos e Funcionalidades (US-035), Ativar/Desativar Sistema (US-036) e Perfis de Usuário
    // (US-037) em Operadores e Permissões, depois de Usuários.
    expect(t.menu[0]?.grupos.find((g) => g.nome === 'Operadores e Permissões')?.itens.map((i) => i.codigo)).toEqual(['adm.usuarios', 'adm.sistema', 'adm.modulos', 'adm.perfis']);
    // Notificações de Desempenho (US-041) em Parâmetros, depois das Alçadas de Aprovação.
    expect(t.menu[0]?.grupos.find((g) => g.nome === 'Parâmetros')?.itens.map((i) => i.codigo)).toEqual(['adm.alcadas', 'adm.notificacoes']);
    expect(t.usuario).toEqual({ nome: 'Nome ana', acessoEm: AGORA.toISOString() });
    expect(t.unidades.map((u) => u.codigo)).toEqual(['TP-A', 'TP-B']);
    expect(t.unidadeAtiva).toBeNull();
  });

  it('orçamentista sem funcionalidade: menu vazio (RN0521)', async () => {
    const ctx = await logado('bia', 'ORCAMENTISTA', []);
    expect((await carregarTelaPrincipal(ctx, { cliente: app })).menu).toEqual([]);
  });

  it('funcionalidade desativada pelo Administrador some do menu', async () => {
    const ctx = await logado('caio', 'ADMINISTRADOR', []);
    await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: false } });
    try {
      // O adm tem outras funcionalidades (alçadas, Histórico): só a desativada some.
      expect((await carregarTelaPrincipal(ctx, { cliente: app })).menu.flatMap((m) => m.grupos.flatMap((g) => g.itens.map((i) => i.codigo)))).not.toContain('adm.usuarios');
    } finally {
      await migrator.funcionalidade.update({ where: { codigo: 'adm.usuarios' }, data: { ativo: true } });
    }
  });
});

// C6 exibirNoMenu (R24 do P4): a permissão vale, mas a funcionalidade não entra no menu.
describe('exibirNoMenu', () => {
  const item = (codigo: string, exibirNoMenu?: boolean): DeclaracaoFuncionalidade => ({
    codigo,
    modulo: 'CADASTROS',
    grupo: 'Pessoal',
    nome: `Tela ${codigo}`,
    rota: `/cad/${codigo.slice(4)}`,
    ordem: 1,
    acoes: ['consultar'],
    perfisPadrao: { AUDITOR: ['consultar'] },
    ...(exibirNoMenu === undefined ? {} : { exibirNoMenu }),
  });
  const codigosDoMenu = (t: Awaited<ReturnType<typeof carregarTelaPrincipal>>) =>
    t.menu.flatMap((m) => m.grupos.flatMap((g) => g.itens.map((i) => i.codigo)));

  it('false: some do menu, a permissão continua; reinstalar com true faz aparecer', async () => {
    await migrator.$transaction((tx) => instalarFuncionalidades(tx, [item('cad.visivel'), item('cad.oculta', false)]));
    const ctx = await logado('duda', 'AUDITOR', []);
    expect(ctx.permissoes.has('cad.oculta:consultar')).toBe(true);
    // O Auditor também tem adm.historico (US-040): o teste olha só as funcionalidades daqui.
    const doTeste = (t: Awaited<ReturnType<typeof carregarTelaPrincipal>>) => codigosDoMenu(t).filter((c) => c.startsWith('cad.'));
    expect(doTeste(await carregarTelaPrincipal(ctx, { cliente: app }))).toEqual(['cad.visivel']);

    await migrator.$transaction((tx) => instalarFuncionalidades(tx, [item('cad.visivel'), item('cad.oculta', true)]));
    expect(doTeste(await carregarTelaPrincipal(ctx, { cliente: app })).sort()).toEqual(['cad.oculta', 'cad.visivel']);
  });

  it('casos de IA do orc (P14): a GFIN tem a permissão, e o menu não mostra as funcionalidades da IA', async () => {
    await executarSeeds(migrator, [seedOrc]);
    const ctx = await logado('gabi', 'GFIN', []);
    expect(ctx.permissoes.has(['orc.ia_justificativa', 'executar'].join(':'))).toBe(true);
    const orc = codigosDoMenu(await carregarTelaPrincipal(ctx, { cliente: app })).filter((c) => c.startsWith('orc.'));
    // P17: a consulta das propostas de TP fica no menu Cadastros, que vem antes da Administração Central.
    expect(orc).toEqual(['orc.propostas', 'orc.metas', 'orc.empregados', 'orc.qtde_empregados', 'orc.viagens', 'orc.bens', 'orc.totalizadores', 'orc.rateio', 'orc.orcamento', 'orc.exercicios', 'orc.importacao', 'orc.receitas', 'orc.posicoes', 'orc.pacotes', 'orc.aprovacao']);
  });

  it('ADMINISTRADOR (#403): só a permissão da sugestão de conta no orc, para a avaliação na /int/ia; nada do orc no menu', async () => {
    await executarSeeds(migrator, [seedOrc]);
    const ctx = await logado('iara', 'ADMINISTRADOR', []);
    expect([...ctx.permissoes].filter((p) => p.startsWith('orc.'))).toEqual([['orc.ia_sugestao_conta', 'executar'].join(':')]);
    expect(codigosDoMenu(await carregarTelaPrincipal(ctx, { cliente: app })).filter((c) => c.startsWith('orc.'))).toEqual([]);
  });
});

describe('unidade ativa no contexto', () => {
  it('uma só unidade vira a ativa', async () => expect((await logado('dani', 'ORCAMENTISTA', [unidades.a])).unidadeId).toBe(unidades.a));
  it('cookie dentro da lista → ativa', async () =>
    expect((await logado('edu', 'ORCAMENTISTA', [unidades.a, unidades.b], unidades.b)).unidadeId).toBe(unidades.b));
  it('cookie fora da lista → nula', async () =>
    expect((await logado('fabi', 'ORCAMENTISTA', [unidades.a, unidades.b], unidades.inativa)).unidadeId).toBeNull());
  it('cookie com unidade inativa do próprio usuário → ignorado (sobra a única ativa)', async () =>
    expect((await logado('ivo', 'ORCAMENTISTA', [unidades.a, unidades.inativa], unidades.inativa)).unidadeId).toBe(unidades.a));
  it('unidades do contexto (US-007): só as ativas do usuário; vazia com a troca de senha pendente', async () => {
    expect([...((await logado('kaka', 'ORCAMENTISTA', [unidades.a, unidades.inativa])).unidades ?? [])]).toEqual([unidades.a]);
    expect((await logado('lulu', 'ORCAMENTISTA', [unidades.a], undefined, true)).unidades).toEqual([]);
  });
  it('troca de senha pendente → sem unidade ativa, mesmo com uma só', async () =>
    expect((await logado('juca', 'ORCAMENTISTA', [unidades.a], undefined, true)).unidadeId).toBeNull());
});

describe('validarTrocaUnidade', () => {
  it('aceita unidade da lista', async () => {
    const ctx = await logado('gil', 'ORCAMENTISTA', [unidades.a, unidades.b]);
    await expect(validarTrocaUnidade(ctx, unidades.b, { cliente: app })).resolves.toBeUndefined();
  });
  it('recusa unidade fora da lista ou inativa com ErroPermissao (negação auditada pela guarda)', async () => {
    const ctx = await logado('hugo', 'ORCAMENTISTA', [unidades.a, unidades.inativa]);
    await expect(validarTrocaUnidade(ctx, unidades.b, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
    await expect(validarTrocaUnidade(ctx, unidades.inativa, { cliente: app })).rejects.toBeInstanceOf(ErroPermissao);
  });
});
