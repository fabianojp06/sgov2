import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

const req = (caminho: string, opcoes: { metodo?: string; cabecalhos?: Record<string, string>; cookie?: boolean } = {}) =>
  new NextRequest(new URL(caminho, 'http://127.0.0.1:3100'), {
    method: opcoes.metodo ?? 'GET',
    headers: { ...(opcoes.cookie ? { cookie: 'sgo_sessao=abc' } : {}), ...opcoes.cabecalhos },
  });

// O proxy repassa os cabeçalhos da requisição ao Next em x-middleware-request-<nome>.
const ipRepassado = (r: Response) => r.headers.get('x-middleware-request-x-sgo-ip');

afterEach(() => vi.unstubAllEnvs());

describe('proxy.ts', () => {
  it('sem cookie: GET /inicio → 307 para /login; POST → 303', () => {
    const g = proxy(req('/inicio'));
    expect(g.status).toBe(307);
    expect(new URL(g.headers.get('location') ?? '').pathname).toBe('/login');
    expect(proxy(req('/inicio', { metodo: 'POST' })).status).toBe(303);
  });

  it('/login sem cookie passa', () => expect(proxy(req('/login')).status).toBe(200));

  it.each([['/login'], ['/inicio']])('cabeçalhos de segurança também em %s sem cookie', (caminho) => {
    const r = proxy(req(caminho));
    expect(r.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('com URL_PUBLICA https, exige e limpa __Host-sgo_sessao', () => {
    vi.stubEnv('URL_PUBLICA', 'https://sgo.exemplo.org');
    expect(proxy(req('/inicio', { cookie: true })).status).toBe(307);
    const comHost = new NextRequest(new URL('/inicio', 'http://127.0.0.1:3100'), { headers: { cookie: '__Host-sgo_sessao=abc' } });
    expect(proxy(comHost).status).toBe(200);
    const saiu = proxy(req('/login?saiu=1', { cabecalhos: { 'sec-fetch-site': 'same-origin' } }));
    expect(saiu.headers.getSetCookie().join('\n')).toMatch(/__Host-sgo_sessao=;.*Secure/i);
  });

  it('página do sistema com cookie: no-store e cabeçalhos de segurança', () => {
    const r = proxy(req('/inicio', { cookie: true }));
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('x-sgo-ip do cliente é descartado; sem CONFIAR_PROXY, IP nulo', () => {
    const r = proxy(req('/login', { cabecalhos: { 'x-sgo-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6' } }));
    expect(ipRepassado(r)).toBeNull();
  });

  it('com CONFIAR_PROXY=1, vale o último salto do X-Forwarded-For', () => {
    vi.stubEnv('CONFIAR_PROXY', '1');
    const r = proxy(req('/login', { cabecalhos: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-sgo-ip': '1.1.1.1' } }));
    expect(ipRepassado(r)).toBe('203.0.113.9');
  });

  it.each([['lixo'], ['6.6.6.6, fe80::1%eth0'], ['']])('XFF inválido %j → IP nulo', (xff) => {
    vi.stubEnv('CONFIAR_PROXY', '1');
    expect(ipRepassado(proxy(req('/login', { cabecalhos: { 'x-forwarded-for': xff } })))).toBeNull();
  });

  it('GET /login?saiu=1 da mesma origem limpa os cookies e o armazenamento, sem "cookies"', () => {
    const r = proxy(req('/login?saiu=1', { cabecalhos: { 'sec-fetch-site': 'same-origin' }, cookie: true }));
    const setCookie = r.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(/sgo_sessao=;.*Max-Age=0/i);
    expect(setCookie).toMatch(/sgo_unidade=;.*Max-Age=0/i);
    expect(r.headers.get('clear-site-data')).toBe('"storage"');
  });

  it('GET /login?saiu=1 vindo de outro site não limpa nada', () => {
    const r = proxy(req('/login?saiu=1', { cabecalhos: { 'sec-fetch-site': 'cross-site' }, cookie: true }));
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(r.headers.get('clear-site-data')).toBeNull();
  });

  it('matcher cobre /login (POST de Server Action) e exclui só os estáticos', () => {
    const [padrao] = config.matcher;
    const re = new RegExp(`^${padrao}$`);
    expect(re.test('/login')).toBe(true);
    expect(re.test('/inicio')).toBe(true);
    expect(re.test('/_next/static/a.js')).toBe(false);
    expect(re.test('/_next/image')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
  });
});
