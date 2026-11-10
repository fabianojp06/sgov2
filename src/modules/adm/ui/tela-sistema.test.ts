import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoAuditoria } from '@/shared/audit';
import type { ContextoRequisicao } from '@/shared/authz';
import { configurarAuditorNegacao, configurarProvedorContexto } from '@/shared/authz/configuracao';
import { limparJanelaNegacoes } from '@/shared/authz/guarda';
import { DesativarSistema } from './desativar-sistema';
import { TelaSistema } from './tela-sistema';

// Tela Ativação e Desativação do Sistema (US-036, UC02.01; RN0064, D-P9-10) e a guarda da página,
// sem banco: os casos de uso vêm do mock.
vi.mock('next/server', () => ({ connection: async () => undefined }));
const dados = vi.hoisted(() => ({ estado: { ativo: true, desativacaoEm: null as Date | null, motivo: null, por: null } }));
vi.mock('@/modules/adm', async (original) => ({
  ...(await original<typeof import('@/modules/adm')>()),
  consultarEstadoSistema: async () => dados.estado,
  listarAtivacoes: async () => [],
}));
const { default: Pagina } = await import('../../../app/(sistema)/adm/sistema/page');

const acao = async () => ({ ok: true as const, valor: undefined });
const EM = new Date('2026-11-11T15:30:00.000Z'); // 12:30 em Brasília
const tela = (estado: { ativo: boolean; desativacaoEm: Date | null }, extra: { podeAlterar?: boolean; aviso?: string } = {}) =>
  renderToString(
    createElement(TelaSistema, {
      estado,
      ativacoes: [
        { tipo: 'Ativação', motivo: null, em: EM, usuario: 'Ana' },
        { tipo: 'Desativação', motivo: 'Virada', em: EM, usuario: 'Bia' },
      ],
      podeAlterar: extra.podeAlterar ?? true,
      aviso: extra.aviso,
      ativar: acao,
      desativar: acao,
    }),
  );
const habilitado = (h: string, rotulo: string) => new RegExp(`<button type="button">${rotulo}</button>`).test(h);
const desabilitado = (h: string, rotulo: string) => new RegExp(`<button type="button" disabled="">${rotulo}</button>`).test(h);

describe('TelaSistema', () => {
  it('ativo e sem contagem: status ATIVO, só Desativar habilitado', () => {
    const h = tela({ ativo: true, desativacaoEm: null });
    expect(h).toContain('O sistema encontra-se atualmente ATIVO');
    expect(habilitado(h, 'Desativar') && desabilitado(h, 'Ativar')).toBe(true);
  });

  it('inativo: status INATIVO, só Ativar habilitado', () => {
    const h = tela({ ativo: false, desativacaoEm: EM });
    expect(h).toContain('O sistema encontra-se atualmente INATIVO');
    expect(habilitado(h, 'Ativar') && desabilitado(h, 'Desativar')).toBe(true);
  });

  it('durante a contagem: ATIVO, o agendamento e só Ativar habilitado (cancela)', () => {
    const h = tela({ ativo: true, desativacaoEm: EM });
    expect(h).toContain('O sistema encontra-se atualmente ATIVO');
    expect(h).toContain('A desativação do sistema está agendada para 12:30.');
    expect(habilitado(h, 'Ativar') && desabilitado(h, 'Desativar')).toBe(true);
  });

  it('sem alterar: os dois desabilitados', () => {
    const h = tela({ ativo: true, desativacaoEm: null }, { podeAlterar: false });
    expect(desabilitado(h, 'Ativar') && desabilitado(h, 'Desativar')).toBe(true);
  });

  it.each([
    ['ativado', { ativo: true, desativacaoEm: null }, 'O sistema foi ativado com sucesso.'],
    ['desativado', { ativo: false, desativacaoEm: EM }, 'O sistema foi desativado com sucesso.'],
    ['agendado', { ativo: true, desativacaoEm: EM }, 'A desativação do sistema foi agendada para 12:30.'],
  ])('aviso=%s → %s', (aviso, estado, texto) => expect(tela(estado, { aviso })).toContain(`<p role="status">${texto}</p>`));

  it('aviso desconhecido ou agendado sem contagem: nada', () => {
    expect(tela({ ativo: true, desativacaoEm: null }, { aviso: 'agendado' })).not.toContain('role="status">A desativação');
    expect(tela({ ativo: true, desativacaoEm: null }, { aviso: 'outro' })).not.toMatch(/<p role="status">[^<]/);
  });

  it('histórico com o tipo, o motivo ("—" na ativação), a data/hora e o usuário', () => {
    const h = tela({ ativo: true, desativacaoEm: null });
    expect(h).toContain('Histórico de ativações e desativações');
    for (const t of ['Ativação', 'Desativação', 'Virada', '—', 'Ana', 'Bia', '11/11/2026']) expect(h).toContain(t);
  });
});

describe('DesativarSistema', () => {
  it('fechado: só o botão; habilitado conforme a prop', () => {
    expect(renderToString(createElement(DesativarSistema, { acao, habilitado: true }))).toBe('<button type="button">Desativar</button>');
    expect(renderToString(createElement(DesativarSistema, { acao, habilitado: false }))).toBe('<button type="button" disabled="">Desativar</button>');
  });
});

describe('página /adm/sistema', () => {
  const ID = '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c';
  const ctx = (permissoes: string[]): ContextoRequisicao => ({ usuarioId: ID, usuarioRotulo: 'adm', sessaoUid: 's1', ip: null, permissoes: new Set(permissoes) });
  let contexto: ContextoRequisicao;
  let negacoes: EventoAuditoria[];
  const digest = (p: Promise<unknown>) => p.then(() => 'sem erro', (e: { digest?: string }) => e.digest ?? String(e));

  beforeEach(() => {
    negacoes = [];
    limparJanelaNegacoes();
    configurarProvedorContexto({ obter: async () => contexto });
    configurarAuditorNegacao(async (e) => {
      negacoes.push(e);
    });
  });

  it('sem consultar → 404 com a negação auditada', async () => {
    contexto = ctx(['aut.tela_principal:consultar']);
    expect(await digest(Pagina({ searchParams: Promise.resolve({}) }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(negacoes.map((n) => n.funcionalidade)).toEqual(['adm.sistema']);
  });

  it('só consultar: a tela sem botão habilitado', async () => {
    contexto = ctx(['adm.sistema:consultar']);
    const h = renderToString((await Pagina({ searchParams: Promise.resolve({}) })) as Parameters<typeof renderToString>[0]);
    expect(h).toContain('Ativação e Desativação do Sistema');
    expect(h).not.toMatch(/<button type="button">(Ativar|Desativar)<\/button>/);
  });
});
