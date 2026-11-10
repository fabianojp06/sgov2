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
const csp = (r: Response) => r.headers.get('content-security-policy') ?? '';
const diretiva = (r: Response, nome: string) =>
  csp(r)
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === nome || d.startsWith(`${nome} `));
const nonce = (r: Response) => /'nonce-([^']+)'/.exec(diretiva(r, 'script-src') ?? '')?.[1];

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
    expect(diretiva(r, 'frame-ancestors')).toBe("frame-ancestors 'none'");
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
    expect(diretiva(r, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
  });

  // CSP completa (#318, decisão do PO em 10/11): script só com o nonce da requisição; o Next lê o
  // nonce do cabeçalho da requisição e o põe nos scripts dele (SSR).
  it('CSP completa: script só com nonce, sem eval nem inline, e o resto restrito à origem', () => {
    const r = proxy(req('/inicio', { cookie: true }));
    expect(diretiva(r, 'default-src')).toBe("default-src 'self'");
    expect(diretiva(r, 'script-src')).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic'$/);
    expect(diretiva(r, 'object-src')).toBe("object-src 'none'");
    expect(diretiva(r, 'base-uri')).toBe("base-uri 'self'");
    expect(diretiva(r, 'form-action')).toBe("form-action 'self'");
    expect(diretiva(r, 'connect-src')).toBe("connect-src 'self'");
    expect(diretiva(r, 'img-src')).toBe("img-src 'self' blob: data:");
    // Estilo inline fica liberado: há atributos style e <style> nas telas; com nonce, o
    // 'unsafe-inline' seria ignorado pelo navegador.
    expect(diretiva(r, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(csp(r)).not.toContain('unsafe-eval');
  });

  it('o nonce muda a cada requisição e vai também na requisição repassada ao Next', () => {
    const a = proxy(req('/inicio', { cookie: true }));
    const b = proxy(req('/inicio', { cookie: true }));
    expect(nonce(a)).toBeDefined();
    expect(nonce(a)).not.toBe(nonce(b));
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp(a));
  });

  it('CSP enviada pelo cliente na requisição é trocada pela do proxy', () => {
    const r = proxy(req('/login', { cabecalhos: { 'content-security-policy': "script-src 'unsafe-inline'" } }));
    expect(r.headers.get('x-middleware-request-content-security-policy')).toBe(csp(r));
  });

  it('upgrade-insecure-requests só com URL_PUBLICA https; unsafe-eval só em desenvolvimento', () => {
    expect(diretiva(proxy(req('/login')), 'upgrade-insecure-requests')).toBeUndefined();
    vi.stubEnv('URL_PUBLICA', 'https://sgo.exemplo.org');
    expect(diretiva(proxy(req('/login')), 'upgrade-insecure-requests')).toBe('upgrade-insecure-requests');
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'development');
    expect(diretiva(proxy(req('/login')), 'script-src')).toContain("'unsafe-eval'");
  });

  it('redirecionamento para o login também leva a CSP completa', () => {
    expect(nonce(proxy(req('/inicio')))).toBeDefined();
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
