import { describe, expect, it } from 'vitest';
import { nomeCookieSessao, opcoesCookieSessao } from './cookies';

describe('cookie de sessão', () => {
  const https = { urlPublica: 'https://sgo.exemplo.org', seguro: true, confiarProxy: true };
  const http = { urlPublica: 'http://127.0.0.1:3190', seguro: false, confiarProxy: false };
  it('https → __Host- e Secure', () => {
    expect(nomeCookieSessao(https)).toBe('__Host-sgo_sessao');
    expect(opcoesCookieSessao(new Date(0), https)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: true });
  });
  it('http em loopback → sgo_sessao sem Secure', () => {
    expect(nomeCookieSessao(http)).toBe('sgo_sessao');
    expect(opcoesCookieSessao(new Date(0), http).secure).toBe(false);
  });
});
