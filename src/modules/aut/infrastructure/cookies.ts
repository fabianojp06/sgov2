import { lerEnvAcesso } from '@/shared/config';

// Cookie de sessão: __Host- e Secure quando a URL_PUBLICA é https; sem prefixo em http (dev e
// E2E em 127.0.0.1). Todos os pontos (proxy, provedor, login, logoff) usam esta função.
export function nomeCookieSessao(env = lerEnvAcesso()): string {
  return env.seguro ? '__Host-sgo_sessao' : 'sgo_sessao';
}

export const COOKIE_UNIDADE = 'sgo_unidade';

export function opcoesCookieSessao(expires: Date, env = lerEnvAcesso()) {
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: env.seguro, expires };
}
