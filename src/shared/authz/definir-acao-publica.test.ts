import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ErroDominio, ok } from '@/shared/kernel';
import { definirAcaoPublica } from './definir-acao-publica';

const cabecalhos = vi.hoisted(() => ({ valor: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => cabecalhos.valor }));

afterEach(() => {
  vi.restoreAllMocks();
  cabecalhos.valor = new Headers();
});

const entrada = z.object({ login: z.string().min(1, 'Informe o login'), senha: z.string() });

describe('definirAcaoPublica', () => {
  it('entrada inválida → erro por campo, sem executar', async () => {
    const executar = vi.fn();
    const acao = definirAcaoPublica({ nome: 'login', entrada }, executar);
    expect(await acao({ login: '', senha: 'x' })).toEqual({ ok: false, erros: [{ campo: 'login', mensagem: 'Informe o login' }] });
    expect(executar).not.toHaveBeenCalled();
  });

  it('mensagem padrão do Zod em português também na ação pública (#177)', async () => {
    const acao = definirAcaoPublica({ nome: 'login', entrada }, vi.fn());
    expect(await acao('lixo')).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Entrada inválida: esperava um objeto, recebeu um texto' }] });
  });

  it('passa o IP do x-sgo-ip (definido pelo proxy) e devolve o resultado', async () => {
    cabecalhos.valor = new Headers({ 'x-sgo-ip': '203.0.113.9' });
    const acao = definirAcaoPublica({ nome: 'login', entrada }, async (e, ctx) => ok(`${e.login}@${ctx.ip}`));
    expect(await acao({ login: 'ana', senha: 'x' })).toEqual({ ok: true, valor: 'ana@203.0.113.9' });
  });

  it('sem x-sgo-ip → IP nulo', async () => {
    const acao = definirAcaoPublica({ nome: 'login', entrada }, async (_e, ctx) => ok(ctx.ip));
    expect(await acao({ login: 'ana', senha: 'x' })).toEqual({ ok: true, valor: null });
  });

  it('ErroDominio → erro geral com a mensagem', async () => {
    const acao = definirAcaoPublica({ nome: 'login', entrada }, async () => {
      throw new ErroDominio('x', 'Mensagem de tela');
    });
    expect(await acao({ login: 'a', senha: 'b' })).toEqual({ ok: false, erros: [{ campo: '_', mensagem: 'Mensagem de tela' }] });
  });

  it('erro qualquer → mensagem inesperada, sem a entrada no log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acao = definirAcaoPublica({ nome: 'login', entrada }, async () => {
      throw new Error('quebrou');
    });
    expect(await acao({ login: 'a', senha: 'SegredoQualquer9' })).toEqual({
      ok: false,
      erros: [{ campo: '_', mensagem: 'Erro inesperado. Tente novamente.' }],
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SegredoQualquer9');
  });

  it('redirect do Next passa adiante', async () => {
    const { redirect } = await import('next/navigation');
    const acao = definirAcaoPublica({ nome: 'login', entrada }, async () => redirect('/inicio'));
    await expect(acao({ login: 'a', senha: 'b' })).rejects.toThrow('NEXT_REDIRECT');
  });
});
