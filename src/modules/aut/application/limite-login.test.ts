import { describe, expect, it } from 'vitest';
import { criarLimitadorLogin } from './limite-login';

describe('limitador do login (D-P5-1)', () => {
  it('por IP contam só as falhas: 10 falhas recusam o próximo; a janela libera depois (NAT, decisão do PO)', () => {
    let t = 0;
    const l = criarLimitadorLogin({ agora: () => t });
    for (let i = 0; i < 30; i++) expect(l.permitir('203.0.113.9', `certo${i}`)).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(l.permitir('203.0.113.9', `u${i}`)).toBe(true);
      l.registrarFalha('203.0.113.9');
    }
    expect(l.permitir('203.0.113.9', 'outro')).toBe(false);
    t = 5 * 60 * 1000 + 1;
    expect(l.permitir('203.0.113.9', 'outro')).toBe(true);
  });

  it('registrarFalha sem IP não faz nada', () => {
    const l = criarLimitadorLogin({ agora: () => 0 });
    l.registrarFalha(null);
    expect(l.tamanho()).toEqual({ porIp: 0, porLogin: 0 });
  });

  it('21º do mesmo login, vindo de IPs diferentes, é recusado', () => {
    const l = criarLimitadorLogin({ agora: () => 0 });
    for (let i = 0; i < 20; i++) expect(l.permitir(`10.0.0.${i}`, 'ana')).toBe(true);
    expect(l.permitir('10.0.1.1', 'ana')).toBe(false);
  });

  it('IP nulo: só vale o limite por login, e logins diferentes não se bloqueiam', () => {
    const l = criarLimitadorLogin({ agora: () => 0 });
    for (let i = 0; i < 30; i++) expect(l.permitir(null, `u${i}`)).toBe(true);
  });

  it('teto de 10.000 chaves, com descarte da mais antiga', () => {
    const l = criarLimitadorLogin({ agora: () => 0, porLogin: 1 });
    for (let i = 0; i <= 10_000; i++) l.permitir(null, `u${i}`);
    expect(l.tamanho()).toEqual({ porIp: 0, porLogin: 10_000 });
    // u0 saiu (ganha janela nova); u10000 continua contado.
    expect(l.permitir(null, 'u10000')).toBe(false);
    expect(l.permitir(null, 'u0')).toBe(true);
  });

  it('espera padrão de 2 s', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const l = criarLimitadorLogin({ concorrencia: 1 });
      let liberar = () => {};
      const a = l.executar(() => new Promise<void>((r) => (liberar = r)));
      const b = l.executar(async () => 'b');
      await vi.advanceTimersByTimeAsync(1999);
      liberar();
      await a;
      expect(await b).toBe('b');
      const c = l.executar(() => new Promise<void>(() => {}));
      const d = l.executar(async () => 'd');
      await vi.advanceTimersByTimeAsync(2001);
      expect(await d).toBe('OCUPADO');
      void c;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fila com no máximo 50 em espera: o excedente recebe OCUPADO na hora', async () => {
    const l = criarLimitadorLogin({ concorrencia: 1, esperaMs: 10_000 });
    let liberar = () => {};
    const travada = new Promise<void>((r) => (liberar = r));
    const ativos = [l.executar(() => travada)];
    for (let i = 0; i < 50; i++) ativos.push(l.executar(() => travada));
    expect(await l.executar(async () => 'x')).toBe('OCUPADO');
    liberar();
    await Promise.all(ativos);
  });

  it('concorrência 2: a terceira espera; sem vaga em 2 s, devolve OCUPADO sem rodar', async () => {
    const l = criarLimitadorLogin({ esperaMs: 50 });
    let liberar = () => {};
    const travada = new Promise<void>((r) => (liberar = r));
    let rodou = 0;
    const lenta = () => travada.then(() => ++rodou);
    const a = l.executar(lenta);
    const b = l.executar(lenta);
    expect(await l.executar(async () => ++rodou)).toBe('OCUPADO');
    liberar();
    await Promise.all([a, b]);
    expect(rodou).toBe(2);
  });

  it('a terceira roda quando uma vaga abre dentro da espera', async () => {
    const l = criarLimitadorLogin({ esperaMs: 1000 });
    let liberar = () => {};
    const travada = new Promise<void>((r) => (liberar = r));
    const a = l.executar(() => travada.then(() => 'a'));
    const b = l.executar(() => travada.then(() => 'b'));
    const c = l.executar(async () => 'c');
    setTimeout(liberar, 20);
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c']);
  });

  it('falha da função libera a vaga', async () => {
    const l = criarLimitadorLogin({ esperaMs: 10, concorrencia: 1 });
    await expect(l.executar(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await l.executar(async () => 'ok')).toBe('ok');
  });
});
