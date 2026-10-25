import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { EventoAuditoria } from '@/shared/audit';
import { ErroDominio, ok } from '@/shared/kernel';
import { configurarAuditorNegacao, configurarProvedorContexto } from './configuracao';
import { definirAcao } from './definir-acao';
import { definirRota } from './definir-rota';
import { limparJanelaNegacoes } from './guarda';
import * as publico from './index';
import { ErroPermissao, type ContextoRequisicao } from './tipos';

// Casos da revisão de código (12.12) da US-008.
const ctx: ContextoRequisicao = {
  usuarioId: '0b1e6f1a-5c39-4c2b-9e0a-3d6f1f2a4b5c',
  usuarioRotulo: 'ana',
  sessaoUid: 's1',
  ip: '10.0.0.1',
  permissoes: new Set(['usuarios:incluir', 'usuarios:alterar']),
};
const INESPERADO = [{ campo: '_', mensagem: 'Erro inesperado. Tente novamente.' }];
let negacoes: EventoAuditoria[];

beforeEach(() => {
  vi.restoreAllMocks();
  negacoes = [];
  limparJanelaNegacoes();
  configurarProvedorContexto({ obter: async () => ctx });
  configurarAuditorNegacao(async (e) => {
    negacoes.push(e);
  });
});

describe('definirAcao nunca lança (TRAVA O ERRO)', () => {
  it('provedor de contexto que lança → erro inesperado com log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    configurarProvedorContexto({
      obter: async () => {
        throw new Error('banco fora');
      },
    });
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.unknown() }, async () => ok(1));
    expect(await acao({})).toEqual({ ok: false, erros: INESPERADO });
    expect(log).toHaveBeenCalled();
  });

  it('transform do schema que lança → erro inesperado com log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entrada = z.string().transform(() => {
      throw new Error('bug no schema');
    });
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async () => ok(1));
    expect(await acao('x')).toEqual({ ok: false, erros: INESPERADO });
    expect(log).toHaveBeenCalled();
  });

  it('schema com refinamento assíncrono funciona', async () => {
    const entrada = z.string().refine(async (v) => v === 'ok', 'inválido');
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada }, async (e) => ok(e));
    expect(await acao('ok')).toEqual({ ok: true, valor: 'ok' });
    expect(await acao('x')).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'inválido' }] });
  });

  it('Resultado mal formado de executar → erro inesperado com log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.unknown() }, async () =>
      undefined as never,
    );
    expect(await acao({})).toEqual({ ok: false, erros: INESPERADO });
    expect(log).toHaveBeenCalled();
  });

  it('redirect() do Next passa adiante, sem virar erro inesperado', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.unknown() }, async () =>
      redirect('/depois'),
    );
    await expect(acao({})).rejects.toThrow(expect.objectContaining({ digest: expect.stringContaining('NEXT_REDIRECT') }));
    expect(log).not.toHaveBeenCalled();
  });

  it('log de erro inesperado traz o contexto e não o objeto bruto do erro', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.unknown() }, async () => {
      throw Object.assign(new Error('falhou'), { argumentosDaQuery: { cpf: '123' } });
    });
    await acao({});
    const texto = JSON.stringify(log.mock.calls);
    expect(texto).toContain('usuarios');
    expect(texto).toContain(ctx.usuarioId!);
    expect(texto).toContain('falhou');
    expect(texto).not.toContain('123');
  });
});

describe('negação', () => {
  it('falha ao auditar a negação vai para o log com o contexto e marcador estável', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    configurarAuditorNegacao(async () => {
      throw new Error('banco fora');
    });
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'excluir', entrada: z.unknown() }, async () => ok(1));
    expect(await acao({})).toMatchObject({ status: 403 });
    const texto = JSON.stringify(log.mock.calls);
    expect(texto).toContain('[AUDITORIA_NEGACAO_FALHOU]');
    expect(texto).toContain(ctx.usuarioId!);
    expect(texto).toContain('s1');
  });

  it('negações repetidas do mesmo usuário na janela são auditadas uma vez só (DoS)', async () => {
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'excluir', entrada: z.unknown() }, async () => ok(1));
    for (let i = 0; i < 50; i++) expect(await acao({})).toMatchObject({ status: 403 });
    expect(negacoes).toHaveLength(1);
    const outra = definirAcao({ funcionalidade: 'usuarios', acao: 'aprovar', entrada: z.unknown() }, async () => ok(1));
    await outra({});
    expect(negacoes).toHaveLength(2);
  });

  it('ErroPermissao expõe funcionalidade e ação tipadas', () => {
    const e = new ErroPermissao('usuarios', 'excluir');
    expect([e.funcionalidade, e.acao, e.message]).toEqual(['usuarios', 'excluir', 'Você não tem permissão para esta ação.']);
  });
});

describe('definirRota', () => {
  type Handler = Parameters<typeof definirRota>[1];
  const rotaPost = (handler: Handler = vi.fn(async () => new Response('ok'))) =>
    definirRota({ funcionalidade: 'usuarios', acao: 'incluir' }, handler);

  it('provedor que lança → 500 com corpo padrão', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    configurarProvedorContexto({
      obter: async () => {
        throw new Error('x');
      },
    });
    const r = await rotaPost()(new Request('http://sgo.local/api', { method: 'GET' }));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ erros: INESPERADO });
  });

  it('ErroDominio → 422 com a mensagem', async () => {
    const rota = rotaPost(
      vi.fn(async () => {
        throw new ErroDominio('X', 'Regra violada');
      }),
    );
    const r = await rota(new Request('http://sgo.local/api', { method: 'GET' }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ erros: [{ campo: '_', mensagem: 'Regra violada' }] });
  });

  it('repassa os params da rota dinâmica', async () => {
    const handler = vi.fn(async (_req: Request, _c: ContextoRequisicao, rota?: { params: Promise<unknown> }) =>
      Response.json(await rota?.params),
    );
    const r = await rotaPost(handler)(new Request('http://sgo.local/api/1'), { params: Promise.resolve({ id: '1' }) });
    expect(await r.json()).toEqual({ id: '1' });
  });

  it.each([
    ['Origin de outro site', { origin: 'https://atacante.example' }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['sem Origin nem Sec-Fetch-Site', {}],
  ])('POST com %s → 403 (CSRF) e não executa', async (_caso, headers) => {
    const handler = vi.fn(async () => new Response('ok'));
    const r = await rotaPost(handler)(new Request('http://sgo.local/api', { method: 'POST', headers }));
    expect(r.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('POST da mesma origem passa', async () => {
    const r = await rotaPost()(
      new Request('http://sgo.local/api', { method: 'POST', headers: { origin: 'http://sgo.local' } }),
    );
    expect(r.status).toBe(200);
  });
});

describe('configuração fora da API pública', () => {
  it('o index não expõe configurarProvedorContexto nem configurarAuditorNegacao', () => {
    expect(Object.keys(publico)).not.toContain('configurarProvedorContexto');
    expect(Object.keys(publico)).not.toContain('configurarAuditorNegacao');
  });
});

describe('revisão 12.12, rodada 2', () => {
  it('CSRF: log com marcador e mensagem própria', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rota = definirRota({ funcionalidade: 'usuarios', acao: 'incluir' }, async () => new Response('ok'));
    const r = await rota(new Request('http://sgo.local/api', { method: 'POST', headers: { origin: 'https://x.example' } }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erros: [{ campo: '_', mensagem: 'Requisição recusada: origem inválida.' }] });
    expect(JSON.stringify(aviso.mock.calls)).toContain('[AUTHZ_ORIGEM_RECUSADA]');
    expect(JSON.stringify(aviso.mock.calls)).toContain('https://x.example');
  });

  it('negações suprimidas na janela são contadas e aparecem na próxima auditoria', async () => {
    vi.useFakeTimers();
    try {
      const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'excluir', entrada: z.unknown() }, async () => ok(1));
      for (let i = 0; i < 4; i++) await acao({});
      expect(negacoes).toHaveLength(1);
      vi.advanceTimersByTime(6 * 60 * 1000);
      await acao({});
      expect(negacoes.map((n) => n.descricao)).toEqual([
        'Acesso negado à funcionalidade usuarios (excluir)',
        'Acesso negado à funcionalidade usuarios (excluir); 3 tentativas suprimidas desde a última auditoria',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('se a auditoria da negação falha, a próxima tentativa grava (não fica marcada)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let falhar = true;
    configurarAuditorNegacao(async (e) => {
      if (falhar) throw new Error('banco fora');
      negacoes.push(e);
    });
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'excluir', entrada: z.unknown() }, async () => ok(1));
    await acao({});
    falhar = false;
    await acao({});
    expect(negacoes).toHaveLength(1);
  });

  it('em produção, configurar de novo com o mesmo provedor é aceito; com outro, lança', () => {
    const provedor = { obter: async () => ctx };
    configurarProvedorContexto(provedor);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => configurarProvedorContexto(provedor)).not.toThrow();
      expect(() => configurarProvedorContexto({ obter: async () => ctx })).toThrow(/já configurado/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('log de erro inesperado preserva a causa', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acao = definirAcao({ funcionalidade: 'usuarios', acao: 'incluir', entrada: z.unknown() }, async () => {
      throw new Error('fachada', { cause: new Error('causa real') });
    });
    await acao({});
    expect(JSON.stringify(log.mock.calls)).toContain('causa real');
  });
});

describe('revisão 12.12, rodada 3', () => {
  it('em produção, provedor recriado (outra camada do Next) com o mesmo id é aceito', () => {
    configurarProvedorContexto({ id: 'aut', obter: async () => ctx });
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => configurarProvedorContexto({ id: 'aut', obter: async () => ctx })).not.toThrow();
      expect(() => configurarProvedorContexto({ id: 'outro', obter: async () => ctx })).toThrow(/já configurado/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
