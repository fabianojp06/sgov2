import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';

// Guarda e dados das páginas de perfis (US-037; D-P13-12), sem banco: os casos de uso vêm do mock.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const dados = vi.hoisted(() => ({ perfis: [] as unknown[], perfil: null as unknown, grade: [] as unknown[], codigoDaGrade: undefined as string | null | undefined }));
vi.mock('@/modules/adm', async (original) => ({
  ...(await original<typeof import('@/modules/adm')>()),
  listarPerfis: async () => dados.perfis,
  obterPerfil: async () => dados.perfil,
  gradePermissoes: async (_ctx: unknown, codigo: string | null) => {
    dados.codigoDaGrade = codigo;
    return dados.grade;
  },
}));

const { default: Lista } = await import('../../../app/(sistema)/adm/perfis/page');
const { default: Novo } = await import('../../../app/(sistema)/adm/perfis/novo/page');
const { default: Alterar } = await import('../../../app/(sistema)/adm/perfis/[id]/page');

const ID = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: ID, usuarioRotulo: 'adm', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
let contexto: ContextoRequisicao;
let negacoes: EventoAuditoria[];
const TODAS = ['consultar', 'incluir', 'alterar', 'excluir'].map((a) => ['adm.perfis', a].join(':'));
const html = async (p: Promise<unknown>) => renderToString((await p) as Parameters<typeof renderToString>[0]);
const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));
const params = Promise.resolve({ id: ID });

const linha = (id: string, nome: string, padrao: boolean, usuarios: number) => ({ id, codigo: padrao ? 'GFIN' : 'P_0A0B0C0D0E0F', nome, descricao: 'd', ativo: true, padrao, usuarios, usuariosAtivos: usuarios, versao: 2 });
const GRADE = [
  { modulo: 'ADMINISTRACAO', nome: 'Administração', funcionalidades: [{ codigo: 'adm.perfis', nome: 'Perfis de Usuário', grupo: 'G', acoes: ['consultar', 'incluir'], fixas: ['consultar', 'incluir'] }] },
  {
    modulo: 'ORCAMENTARIO',
    nome: 'Orçamentário',
    funcionalidades: [
      { codigo: 'orc.orcamento', nome: 'Orçamento', grupo: 'G', acoes: ['consultar', 'alterar'], fixas: [] },
      { codigo: 'orc.pacotes', nome: 'Pacotes', grupo: 'G', acoes: ['consultar', 'incluir'], fixas: [] },
    ],
  },
];

beforeEach(() => {
  negacoes = [];
  dados.perfis = [];
  dados.perfil = null;
  dados.grade = GRADE;
  dados.codigoDaGrade = undefined;
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('páginas de perfis', () => {
  it('sem permissão: lista, novo e alteração dão 404 com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Lista({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Novo())).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['adm.perfis', 'adm.perfis', 'adm.perfis']);
  });

  it('alteração: id sem perfil → 404', async () => {
    contexto = ctx(TODAS);
    expect(await digest(Alterar({ params }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('lista: Excluir só no perfil da tela sem usuários; link e Novo conforme as permissões; aviso pelo código', async () => {
    dados.perfis = [linha('a', 'Gestor Financeiro', true, 0), linha('b', 'Da Tela Livre', false, 0), linha('c', 'Da Tela Usada', false, 3)];
    contexto = ctx(TODAS);
    const h = await html(Lista({ searchParams: Promise.resolve({ aviso: 'cadastrado' }) }));
    expect(h).toContain('Perfil cadastrado com sucesso.');
    expect(h).toContain('href="/adm/perfis/novo"');
    expect(h).toContain('href="/adm/perfis/b"');
    expect(h).toContain('Excluir Da Tela Livre');
    expect(h).not.toContain('Excluir Da Tela Usada');
    expect(h).not.toContain('Excluir Gestor Financeiro');
    contexto = ctx(['adm.perfis:consultar']);
    const so = await html(Lista({ searchParams: Promise.resolve({ aviso: '<script>' }) }));
    expect(so).not.toContain('href="/adm/perfis/');
    expect(so).not.toContain('Excluir');
    expect(so).not.toContain('script');
  });

  it('cadastro: grade do perfil da tela, sem nada marcado (RN0058), com as exibidas ocultas', async () => {
    contexto = ctx(TODAS);
    dados.grade = GRADE.slice(1);
    const h = await html(Novo());
    expect(dados.codigoDaGrade).toBeNull();
    expect(h).toContain('Definição de Permissões de Acesso');
    expect(h).toMatch(/<input type="hidden" name="exibidas" value="orc.orcamento"\/>/);
    expect(h).not.toMatch(/name="permissao"[^>]*checked=""/);
    expect(h).toContain('<th scope="col">Consultar</th>');
    expect(h).toContain('aria-label="Incluir em Pacotes"');
  });

  it('alteração do Administrador: as adm.* fixas desabilitadas, sem name e fora das exibidas', async () => {
    contexto = ctx(TODAS);
    dados.perfil = { id: ID, codigo: 'ADMINISTRADOR', nome: 'Administrador', descricao: '', ativo: true, padrao: true, administrador: true, usuariosAtivos: 1, versao: 3, permissoes: [{ funcionalidade: 'orc.orcamento', acoes: ['consultar'] }] };
    const h = await html(Alterar({ params }));
    expect(dados.codigoDaGrade).toBe('ADMINISTRADOR');
    expect(h).not.toContain('value="adm.perfis"');
    expect(h).not.toContain('value="adm.perfis:consultar"');
    expect(h).toContain('<input type="checkbox" aria-label="Consultar em Perfis de Usuário" disabled="" checked=""/>');
    expect(h).toContain('<input type="checkbox" aria-label="Consultar em Orçamento" name="permissao" checked="" value="orc.orcamento:consultar"/>');
    expect(h).toContain('<input type="hidden" name="versao" value="3"/>');
    // Revisão 12.12 do #369: o Administrador não pode ser inativado, e a tela já não oferece.
    expect(h).toContain('<input type="radio" disabled="" aria-describedby="perfil-nota-administrador" name="ativo" value="false"/>');
    expect(h).toContain('O perfil Administrador não pode ser inativado.');
  });
});
