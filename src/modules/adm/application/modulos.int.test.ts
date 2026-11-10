import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErroPermissao, type ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { criarPrisma, executarSeeds } from '@/shared/db';
import { ErroDominio } from '@/shared/kernel';
import { iniciarBancoTeste } from '../../../../tests/integracao/banco';
import { MENSAGENS_MODULOS } from '../domain/modulos';
import { seedAdm } from '../infrastructure/seed';
import { alternarFuncionalidade, alternarModulo } from './acoes-modulos';
import { listarCatalogoDoMenu } from './catalogo-ativo';
import type { DeclaracaoFuncionalidade } from './catalogo';
import { instalarFuncionalidades } from './instalar-funcionalidades';
import { carregarPermissoes } from './login';
import { alterarFuncionalidade, alterarModulo, listarModulos } from './modulos';

// Ativar e desativar módulos e funcionalidades (US-035; EP085 UC02.05 e UC02.06; D-P9-7, D-P9-8).
let banco: Awaited<ReturnType<typeof iniciarBancoTeste>>;
let migrator: ReturnType<typeof criarPrisma>;
let app: ReturnType<typeof criarPrisma>;
let ctx: ContextoRequisicao;
let outros: string[];
const deps = () => ({ cliente: app });
const global_ = globalThis as typeof globalThis & { __sgoPrisma?: unknown };

// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const permissoes = (...acoes: string[]) => new Set(acoes.map((a) => `adm.modulos:${a}`));

// Funcionalidades só do teste, em módulos fora da Administração, com permissão para o Orçamentista.
const item = (codigo: string, modulo: DeclaracaoFuncionalidade['modulo'], ordem: number): DeclaracaoFuncionalidade => ({
  codigo,
  modulo,
  grupo: 'Grupo do teste',
  nome: `Tela ${codigo}`,
  rota: `/${codigo.replace('.', '/')}`,
  ordem,
  acoes: ['consultar'],
  perfisPadrao: { ORCAMENTISTA: ['consultar'] },
});

async function usuario(login: string, perfil?: string): Promise<string> {
  const p = perfil ? await migrator.perfil.findUniqueOrThrow({ where: { codigo: perfil } }) : null;
  const u = await migrator.usuario.create({
    data: {
      nome: `Nome ${login}`,
      email: `${login}@example.org`,
      login,
      loginNormalizado: login,
      senhaHash: 'x',
      trocaSenhaObrigatoria: false,
      ...(p ? { perfis: { create: { perfilId: p.id } } } : {}),
    },
  });
  return u.id;
}

beforeAll(async () => {
  banco = await iniciarBancoTeste();
  migrator = criarPrisma(banco.urlMigrator);
  app = criarPrisma(banco.urlApp);
  global_.__sgoPrisma = app; // as ações usam o prisma padrão (sgo_app)
  await executarSeeds(migrator, [seedAdm]);
  await migrator.$transaction((tx) =>
    instalarFuncionalidades(tx, [
      item('cad.um', 'CADASTROS', 1),
      item('cad.dois', 'CADASTROS', 2),
      item('rel.um', 'RELATORIOS', 1),
      item('apr.um', 'APROVACOES', 1),
      item('apr.dois', 'APROVACOES', 2),
    ]),
  );
  const admin = await usuario('adm.modulos', 'ADMINISTRADOR');
  ctx = { usuarioId: admin, usuarioRotulo: 'adm.modulos', sessaoUid: 's1', ip: null, permissoes: permissoes('consultar', 'alterar') };
  outros = [await usuario('orc.modulos', 'ORCAMENTISTA'), await usuario('outro.adm', 'ADMINISTRADOR')];
});

afterAll(async () => {
  try {
    await Promise.allSettled([migrator?.$disconnect(), app?.$disconnect()]);
  } finally {
    await banco?.parar();
  }
});

const ativo = {
  modulo: async (codigo: string) => (await migrator.modulo.findUniqueOrThrow({ where: { codigo } })).ativo,
  funcionalidade: async (codigo: string) => (await migrator.funcionalidade.findUniqueOrThrow({ where: { codigo } })).ativo,
};
const historico = (registroId: string) =>
  migrator.historicoOperacao.findMany({ where: { funcionalidade: 'adm.modulos', registroId }, orderBy: { id: 'asc' }, select: { tipoOperacao: true, descricao: true, usuarioId: true } });
const versoes = async () =>
  Object.fromEntries(
    (await migrator.usuario.findMany({ select: { id: true, acessoVersao: true, versao: true } })).map((u) => [u.id, { acessoVersao: u.acessoVersao, versao: u.versao }]),
  );
const recusa = (mensagem: string) => ({ ok: false, erros: [{ campo: '_', mensagem }] });

describe('listarModulos', () => {
  it('módulos em ordem, cada um com as próprias funcionalidades (RN0047); sem consultar → ErroPermissao', async () => {
    const lista = await listarModulos(ctx, deps());
    expect(lista.map((m) => m.codigo)).toEqual(['ADMINISTRACAO', 'CADASTROS', 'ORCAMENTARIO', 'ADM_CENTRAL', 'RELATORIOS', 'APROVACOES']);
    expect(lista.find((m) => m.codigo === 'CADASTROS')?.funcionalidades.map((f) => f.codigo)).toEqual(['cad.um', 'cad.dois']);
    expect(lista[0]?.funcionalidades.map((f) => f.codigo)).toContain('adm.modulos');
    await expect(listarModulos({ ...ctx, permissoes: new Set() }, deps())).rejects.toBeInstanceOf(ErroPermissao);
  });
});

describe('módulo (UC02.05)', () => {
  it('desativar desativa as funcionalidades na mesma transação (RN0034), com o Histórico, e desconecta só os outros (D-P9-8)', async () => {
    const antes = await versoes();
    expect(await alterarModulo(ctx, { codigo: 'CADASTROS', ativo: false }, deps())).toEqual({ ok: true, valor: undefined });
    expect(await ativo.modulo('CADASTROS')).toBe(false);
    expect([await ativo.funcionalidade('cad.um'), await ativo.funcionalidade('cad.dois')]).toEqual([false, false]);
    expect(await historico('CADASTROS')).toEqual([{ tipoOperacao: 'ALTERACAO', descricao: 'Desativou o módulo Cadastros', usuarioId: ctx.usuarioId }]);
    const depois = await versoes();
    for (const [id, v] of Object.entries(antes)) {
      // A `versao` nunca muda (não gera conflito falso na tela de usuários).
      expect(depois[id]).toEqual({ acessoVersao: v.acessoVersao + (id === ctx.usuarioId ? 0 : 1), versao: v.versao });
    }
    for (const id of outros) expect(depois[id]!.acessoVersao).toBe(antes[id]!.acessoVersao + 1);
  });

  it('ativar não ativa as funcionalidades (RN0033) nem desconecta ninguém (RN0041); repetir não grava', async () => {
    const antes = await versoes();
    expect(await alterarModulo(ctx, { codigo: 'CADASTROS', ativo: true }, deps())).toEqual({ ok: true, valor: undefined });
    expect(await ativo.modulo('CADASTROS')).toBe(true);
    expect([await ativo.funcionalidade('cad.um'), await ativo.funcionalidade('cad.dois')]).toEqual([false, false]);
    expect((await historico('CADASTROS')).map((h) => h.descricao)).toEqual(['Desativou o módulo Cadastros', 'Ativou o módulo Cadastros']);
    expect(await versoes()).toEqual(antes);
    // Já ativo: nada a gravar.
    expect(await alterarModulo(ctx, { codigo: 'CADASTROS', ativo: true }, deps())).toEqual({ ok: true, valor: undefined });
    expect(await historico('CADASTROS')).toHaveLength(2);
  });

  it('módulo inexistente → ErroDominio; sem alterar → ErroPermissao', async () => {
    await expect(alterarModulo(ctx, { codigo: 'NAO_EXISTE', ativo: true }, deps())).rejects.toBeInstanceOf(ErroDominio);
    await expect(alterarModulo({ ...ctx, permissoes: permissoes('consultar') }, { codigo: 'CADASTROS', ativo: false }, deps())).rejects.toBeInstanceOf(ErroPermissao);
    expect(await ativo.modulo('CADASTROS')).toBe(true);
  });
});

describe('funcionalidade (UC02.06)', () => {
  it('com o módulo inativo, ativar é recusado (D-P9-7); com ele ativo, ativa, com o Histórico, sem desconectar ninguém (RN0042)', async () => {
    await alterarModulo(ctx, { codigo: 'RELATORIOS', ativo: false }, deps());
    expect(await alterarFuncionalidade(ctx, { codigo: 'rel.um', ativo: true }, deps())).toEqual(recusa(MENSAGENS_MODULOS.MODULO_INATIVO));
    expect(await ativo.funcionalidade('rel.um')).toBe(false);
    expect(await historico('rel.um')).toEqual([]);

    await alterarModulo(ctx, { codigo: 'RELATORIOS', ativo: true }, deps());
    const antes = await versoes();
    expect(await alterarFuncionalidade(ctx, { codigo: 'rel.um', ativo: true }, deps())).toEqual({ ok: true, valor: undefined });
    expect(await ativo.funcionalidade('rel.um')).toBe(true);
    expect(await historico('rel.um')).toEqual([{ tipoOperacao: 'ALTERACAO', descricao: 'Ativou a funcionalidade Tela rel.um', usuarioId: ctx.usuarioId }]);
    expect(await versoes()).toEqual(antes);
  });

  it('desativar some do menu e das permissões e desconecta os outros (RN0044, D-P9-8); ativar volta', async () => {
    const [orc] = outros as [string];
    await alterarFuncionalidade(ctx, { codigo: 'cad.um', ativo: true }, deps());
    const menu = async () => (await listarCatalogoDoMenu(app)).map((l) => l.funcionalidade.codigo);
    const temPermissao = async () => (await carregarPermissoes(app, orc)).has(['cad.um', 'consultar'].join(':'));
    expect(await menu()).toContain('cad.um');
    expect(await temPermissao()).toBe(true);

    const antes = await versoes();
    expect(await alterarFuncionalidade(ctx, { codigo: 'cad.um', ativo: false }, deps())).toEqual({ ok: true, valor: undefined });
    expect(await menu()).not.toContain('cad.um');
    expect(await temPermissao()).toBe(false);
    expect((await historico('cad.um')).at(-1)?.descricao).toBe('Desativou a funcionalidade Tela cad.um');
    const depois = await versoes();
    for (const [id, v] of Object.entries(antes)) {
      expect(depois[id]).toEqual({ acessoVersao: v.acessoVersao + (id === ctx.usuarioId ? 0 : 1), versao: v.versao });
    }

    // Desativar o módulo também tira o que era dele do menu e das permissões.
    await alterarFuncionalidade(ctx, { codigo: 'cad.um', ativo: true }, deps());
    expect(await temPermissao()).toBe(true);
    await alterarModulo(ctx, { codigo: 'CADASTROS', ativo: false }, deps());
    expect(await menu()).not.toContain('cad.um');
    expect(await temPermissao()).toBe(false);
    await alterarModulo(ctx, { codigo: 'CADASTROS', ativo: true }, deps());
    await alterarFuncionalidade(ctx, { codigo: 'cad.um', ativo: true }, deps());
  });

  it('funcionalidade inexistente → ErroDominio', async () => {
    await expect(alterarFuncionalidade(ctx, { codigo: 'cad.nao_existe', ativo: false }, deps())).rejects.toBeInstanceOf(ErroDominio);
  });
});

describe('ativar funcionalidade × desativar o módulo ao mesmo tempo (trava adm:modulos, D-P9-7)', () => {
  it('no fim, nenhuma funcionalidade fica ativa num módulo inativo', async () => {
    for (let i = 0; i < 6; i++) {
      await alterarModulo(ctx, { codigo: 'APROVACOES', ativo: true }, deps());
      const ativar = () => alterarFuncionalidade(ctx, { codigo: 'apr.um', ativo: true }, deps());
      const desativar = () => alterarModulo(ctx, { codigo: 'APROVACOES', ativo: false }, deps());
      // Alterna quem sai primeiro: as duas ordens terminam no mesmo estado coerente.
      const r = await Promise.all(i % 2 === 0 ? [ativar(), desativar()] : [desativar(), ativar()]);
      expect(r.every((x) => x.ok || JSON.stringify(x) === JSON.stringify(recusa(MENSAGENS_MODULOS.MODULO_INATIVO)))).toBe(true);
      expect(await ativo.modulo('APROVACOES')).toBe(false);
      expect(await migrator.funcionalidade.count({ where: { moduloCodigo: 'APROVACOES', ativo: true } })).toBe(0);
    }
  });
});

describe('Administração protegida (D-P9-7)', () => {
  it('desativar o módulo ADMINISTRACAO ou uma funcionalidade adm.* é recusado, sem gravar nada', async () => {
    const antes = await versoes();
    expect(await alterarModulo(ctx, { codigo: 'ADMINISTRACAO', ativo: false }, deps())).toEqual(recusa(MENSAGENS_MODULOS.MODULO_PROTEGIDO));
    for (const codigo of ['adm.usuarios', 'adm.modulos', 'adm.historico']) {
      expect(await alterarFuncionalidade(ctx, { codigo, ativo: false }, deps())).toEqual(recusa(MENSAGENS_MODULOS.FUNCIONALIDADE_PROTEGIDA));
    }
    expect(await ativo.modulo('ADMINISTRACAO')).toBe(true);
    expect(await migrator.funcionalidade.count({ where: { moduloCodigo: 'ADMINISTRACAO', ativo: false } })).toBe(0);
    expect(await historico('ADMINISTRACAO')).toEqual([]);
    expect(await versoes()).toEqual(antes);
  });

  describe('por chamada direta da ação', () => {
    let negacoes: number;
    beforeEach(() => {
      negacoes = 0;
      limparJanelaNegacoes();
      configurarProvedorContexto({ obter: async () => ctx });
      configurarAuditorNegacao(async () => {
        negacoes++;
      });
    });
    const form = (campos: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      return f;
    };

    it('a ação recusa desativar a Administração e as funcionalidades dela', async () => {
      expect(await alternarModulo(form({ codigo: 'ADMINISTRACAO', ativo: 'false' }))).toEqual(recusa(MENSAGENS_MODULOS.MODULO_PROTEGIDO));
      expect(await alternarFuncionalidade(form({ codigo: 'adm.usuarios', ativo: 'false', modulo: 'ADMINISTRACAO' }))).toEqual(
        recusa(MENSAGENS_MODULOS.FUNCIONALIDADE_PROTEGIDA),
      );
      expect(await ativo.modulo('ADMINISTRACAO')).toBe(true);
      expect(await ativo.funcionalidade('adm.usuarios')).toBe(true);
    });

    it('sem a permissão de alterar → 403, com a negação auditada; o módulo não muda', async () => {
      const semAlterar = { ...ctx, permissoes: permissoes('consultar') };
      configurarProvedorContexto({ obter: async () => semAlterar });
      const r = await alternarModulo(form({ codigo: 'CADASTROS', ativo: 'false' }));
      expect(r).toMatchObject({ ok: false, status: 403 });
      expect(negacoes).toBe(1);
      expect(await ativo.modulo('CADASTROS')).toBe(true);
    });

    it('sucesso volta ao detalhamento do módulo com o aviso (redirect)', async () => {
      const digest = (p: Promise<unknown>) => p.then((r) => JSON.stringify(r), (e: { digest?: string }) => e.digest ?? String(e));
      expect(await digest(alternarFuncionalidade(form({ codigo: 'cad.dois', ativo: 'true', modulo: 'CADASTROS' })))).toMatch(
        /^NEXT_REDIRECT;.*;\/adm\/modulos\?modulo=CADASTROS&aviso=funcionalidade-ativada;/,
      );
      expect(await ativo.funcionalidade('cad.dois')).toBe(true);
    });
  });
});
