import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Guarda e botões da tela de módulos (US-035), sem banco: a lista vem do mock.
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/modules/adm', async (original) => ({
  ...(await original<typeof import('@/modules/adm')>()),
  listarModulos: async () => [
    {
      codigo: 'ADMINISTRACAO',
      nome: 'Administração',
      ativo: true,
      funcionalidades: [{ codigo: 'adm.usuarios', nome: 'Usuários', grupo: 'Operadores e Permissões', ativo: true }],
    },
    {
      codigo: 'CADASTROS',
      nome: 'Cadastros',
      ativo: true,
      funcionalidades: [
        { codigo: 'cad.cargos', nome: 'Cargos', grupo: 'Pessoal', ativo: true },
        { codigo: 'cad.beneficios', nome: 'Benefícios', grupo: 'Pessoal', ativo: false },
      ],
    },
    { codigo: 'RELATORIOS', nome: 'Relatórios', ativo: false, funcionalidades: [{ codigo: 'rel.um', nome: 'Relatório Um', grupo: 'G', ativo: false }] },
  ],
}));

const { default: Modulos } = await import('../../../app/(sistema)/adm/modulos/page');

const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: 'u1', usuarioRotulo: 'adm', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
// "funcionalidade:ação" literal parece usuário:senha para o GitGuardian: as permissões saem daqui.
const perm = (...acoes: string[]) => acoes.map((a) => `adm.modulos:${a}`);
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const html = async (busca: Record<string, string>) =>
  renderToString((await Modulos({ searchParams: Promise.resolve(busca) })) as Parameters<typeof renderToString>[0]);
const botoes = (h: string) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('página de módulos', () => {
  it('sem permissão: 404 com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Modulos({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['adm.modulos']);
  });

  it('lista os módulos; sem módulo aberto, nenhum botão', async () => {
    contexto = ctx(perm('consultar', 'alterar'));
    const h = await html({});
    expect(h).toContain('href="/adm/modulos?modulo=CADASTROS"');
    expect(h).toContain('Relatórios');
    expect(botoes(h)).toEqual([]);
  });

  it('módulo ativo: Desativar no módulo e o botão do status em cada funcionalidade (RN0075)', async () => {
    contexto = ctx(perm('consultar', 'alterar'));
    expect(botoes(await html({ modulo: 'CADASTROS' }))).toEqual(['Desativar', 'Desativar', 'Ativar']);
  });

  it('Administração: nem o módulo nem as funcionalidades têm Desativar (D-P9-7)', async () => {
    contexto = ctx(perm('consultar', 'alterar'));
    const h = await html({ modulo: 'ADMINISTRACAO' });
    expect(h).toContain('Usuários');
    expect(botoes(h)).toEqual([]);
  });

  it('módulo inativo: só Ativar, sem a lista de funcionalidades (pré-condição do UC02.06)', async () => {
    contexto = ctx(perm('consultar', 'alterar'));
    const h = await html({ modulo: 'RELATORIOS' });
    expect(botoes(h)).toEqual(['Ativar']);
    expect(h).not.toContain('Relatório Um');
  });

  it('só consultar: sem botões; aviso só pelo código conhecido', async () => {
    contexto = ctx(perm('consultar'));
    expect(botoes(await html({ modulo: 'CADASTROS', aviso: 'modulo-ativado' }))).toEqual([]);
    expect(await html({ aviso: 'modulo-ativado' })).toContain('Módulo ativado com sucesso.');
    expect(await html({ aviso: '<script>' })).not.toContain('role="status"');
  });
});
