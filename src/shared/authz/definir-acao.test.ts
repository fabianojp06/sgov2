import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ErroAuditoria, type EventoAuditoria } from '@/shared/audit';
import { ErroDominio, ok } from '@/shared/kernel';
import { configurarAuditorNegacao, configurarProvedorContexto } from './configuracao';
import { definirAcao } from './definir-acao';
import { definirRota } from './definir-rota';
import { limparJanelaNegacoes } from './guarda';
import type { ContextoRequisicao } from './tipos';

const ctx: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'ana',
  sessaoUid: 's1',
  ip: '10.0.0.1',
  permissoes: new Set(['usuarios:consultar']),
};

let contexto: ContextoRequisicao | null;
let negacoes: EventoAuditoria[];

beforeEach(() => {
  contexto = ctx;
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => contexto });
  configurarAuditorNegacao(async (evento) => {
    negacoes.push(evento);
  });
});

afterEach(() => vi.restoreAllMocks());

const comPermissao = (...p: string[]) => ({ ...ctx, permissoes: new Set(p) });

describe('definirAcao', () => {
  const entrada = z.object({ nome: z.string().min(1, 'Informe o nome') });

  it('sem contexto → 401 e não executa', async () => {
    contexto = null;
    const executar = vi.fn();
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, executar);
    expect(await acao({ nome: 'x' })).toEqual({
      ok: false,
      status: 401,
      erros: [{ campo: '_', mensagem: 'Sessão expirada. Entre novamente.' }],
    });
    expect(executar).not.toHaveBeenCalled();
    expect(negacoes).toEqual([]);
  });

  it('sem a permissão e com entrada inválida → 403 sem erros de campo, auditado', async () => {
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, vi.fn());
    expect(await acao({ nome: '' })).toEqual({
      ok: false,
      status: 403,
      erros: [{ campo: '_', mensagem: 'Você não tem permissão para esta ação.' }],
    });
    expect(negacoes).toHaveLength(1);
  });

  it('sem a permissão → 403, não executa e audita a negação', async () => {
    const executar = vi.fn();
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, executar);
    expect(await acao({ nome: 'x' })).toEqual({
      ok: false,
      status: 403,
      erros: [{ campo: '_', mensagem: 'Você não tem permissão para esta ação.' }],
    });
    expect(executar).not.toHaveBeenCalled();
    expect(negacoes).toEqual([
      expect.objectContaining({
        tipo: 'SISTEMA',
        origem: 'SISTEMA',
        funcionalidade: 'usuarios',
        descricao: 'Acesso negado à funcionalidade usuarios (incluir)',
        contexto: { usuarioId: ctx.usuarioId, usuarioRotulo: 'ana', sessaoUid: 's1', ip: '10.0.0.1', unidadeId: null },
      }),
    ]);
  });

  it('falha ao auditar a negação ainda responde 403 e vai para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    configurarAuditorNegacao(async () => {
      throw new Error('banco fora');
    });
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, vi.fn());
    expect(await acao({ nome: 'x' })).toMatchObject({ ok: false, status: 403 });
    expect(log).toHaveBeenCalled();
  });

  it('entrada inválida → erros por campo, sem lançar', async () => {
    contexto = comPermissao('usuarios:incluir');
    const executar = vi.fn();
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, executar);
    expect(await acao({ nome: '' })).toEqual({ ok: false, erros: [{ campo: 'nome', mensagem: 'Informe o nome' }] });
    // O { error } passado no tipo (forma usada nos schemas do orc e do adm) também ganha do locale.
    const comErroNoTipo = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.object({ ano: z.coerce.number({ error: 'Informe o ano' }) }) }, vi.fn());
    expect(await comErroNoTipo({ ano: 'x' })).toEqual({ ok: false, erros: [{ campo: 'ano', mensagem: 'Informe o ano' }] });
    expect(await acao('lixo')).toEqual({ ok: false, erros: [expect.objectContaining({ campo: '_' })] });
    expect(executar).not.toHaveBeenCalled();
  });

  it('mensagem padrão do Zod sai em português; a do schema continua valendo (#177)', async () => {
    contexto = comPermissao('usuarios:incluir');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, vi.fn());
    expect(await acao('lixo')).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Entrada inválida: esperava um objeto, recebeu um texto' }] });
    expect(await acao({ nome: 7 })).toEqual({ ok: false, erros: [{ campo: 'nome', mensagem: 'Entrada inválida: esperava um texto, recebeu um número' }] });
    expect(await acao({ nome: '' })).toEqual({ ok: false, erros: [{ campo: 'nome', mensagem: 'Informe o nome' }] });
    // O { error } passado no tipo (forma usada nos schemas do orc e do adm) também ganha do locale.
    const comErroNoTipo = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.object({ ano: z.coerce.number({ error: 'Informe o ano' }) }) }, vi.fn());
    expect(await comErroNoTipo({ ano: 'x' })).toEqual({ ok: false, erros: [{ campo: 'ano', mensagem: 'Informe o ano' }] });
  });

  it('ErroDominio vira mensagem clara', async () => {
    contexto = comPermissao('usuarios:incluir');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async () => {
      throw new ErroDominio('X', 'Mensagem clara');
    });
    expect(await acao({ nome: 'a' })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Mensagem clara' }] });
  });

  it('erro de programação da auditoria (ErroAuditoria) é inesperado: mensagem genérica, não o texto técnico', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    contexto = comPermissao('usuarios:incluir');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async () => {
      throw new ErroAuditoria('AUDITORIA_INVALIDA', 'Evento de auditoria inválido');
    });
    expect(await acao({ nome: 'a' })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Erro inesperado. Tente novamente.' }] });
    expect(log).toHaveBeenCalled();
  });

  it('erro qualquer vira mensagem genérica e vai para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    contexto = comPermissao('usuarios:incluir');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async () => {
      throw new Error('detalhe interno');
    });
    expect(await acao({ nome: 'a' })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Erro inesperado. Tente novamente.' }],
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('usuarios'), expect.anything());
  });

  it('exigir dentro de executar (permissão extra) também vira 403', async () => {
    contexto = comPermissao('usuarios:incluir');
    const { exigir } = await import('./exigir');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async (_e, c) => {
      exigir(c, 'usuarios', 'aprovar');
      return ok(1);
    });
    expect(await acao({ nome: 'a' })).toMatchObject({ ok: false, status: 403 });
    expect(negacoes.map((n) => n.descricao)).toEqual(['Acesso negado à funcionalidade usuarios (aprovar)']);
  });

  it('caminho feliz devolve o Resultado de executar com a entrada validada', async () => {
    contexto = comPermissao('usuarios:incluir');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async (e, c) =>
      ok(`${e.nome} por ${c.usuarioRotulo}`),
    );
    expect(await acao({ nome: 'Bia', extra: 1 })).toEqual({ ok: true, valor: 'Bia por ana' });
  });
});

describe('definirRota', () => {
  it('sem contexto → 401; sem permissão → 403; com permissão → resposta do handler', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    const rota = definirRota({ funcionalidade: 'usuarios', acao: 'exportar' }, handler);
    const req = new Request('http://x/');
    contexto = null;
    const semSessao = await rota(req);
    expect(semSessao.status).toBe(401);
    expect(await semSessao.json()).toEqual({ erros: [{ campo: '_', mensagem: 'Sessão expirada. Entre novamente.' }] });
    contexto = ctx;
    const negada = await rota(req);
    expect(negada.status).toBe(403);
    expect(await negada.json()).toEqual({ erros: [{ campo: '_', mensagem: 'Você não tem permissão para esta ação.' }] });
    expect(handler).not.toHaveBeenCalled();
    contexto = comPermissao('usuarios:exportar');
    expect(await (await rota(req)).text()).toBe('ok');
  });

  it('erro no handler → 500 genérico e log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    contexto = comPermissao('usuarios:exportar');
    const rota = definirRota({ funcionalidade: 'usuarios', acao: 'exportar' }, async () => {
      throw new Error('x');
    });
    const r = await rota(new Request('http://x/'));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ erros: [{ campo: '_', mensagem: 'Erro inesperado. Tente novamente.' }] });
    expect(log).toHaveBeenCalled();
  });
});

describe('definirRota: exigir dentro do handler', () => {
  it('ErroPermissao no handler → 403 auditado', async () => {
    contexto = comPermissao('usuarios:exportar');
    const { exigir } = await import('./exigir');
    const rota = definirRota({ funcionalidade: 'usuarios', acao: 'exportar' }, async (_r, c) => {
      exigir(c, 'usuarios', 'aprovar');
      return new Response('ok');
    });
    const r = await rota(new Request('http://x/'));
    expect(r.status).toBe(403);
    expect(negacoes.map((n) => n.descricao)).toEqual(['Acesso negado à funcionalidade usuarios (aprovar)']);
  });
});
