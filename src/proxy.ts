import { isIP } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { lerEnvAcesso, nomeCookieSessao, nomeCookieUnidade } from '@/shared/config';

// Proxy (o middleware do Next 16), da frente A (spec §12.3). Só confere se o cookie existe: quem
// valida a sessão é o provedor de contexto do aut. Também resolve o IP do cliente, limpa os
// cookies no logoff e aplica os cabeçalhos de segurança (plano do P5, Task 2b).
const PUBLICAS = new Set(['/', '/login']);
// O mesmo nome de CABECALHO_IP de @/shared/authz (que carrega o Prisma e fica fora do proxy).
const CABECALHO_IP = 'x-sgo-ip';
// O mesmo nome de CABECALHO_SEM_RENOVACAO de @/shared/authz: a consulta periódica do aviso de
// desativação (D-P9-4) não renova a sessão, para a inatividade valer numa aba esquecida aberta.
const CABECALHO_SEM_RENOVACAO = 'x-sgo-sem-renovacao';
const ROTA_AVISO = '/aut/aviso';

// Último salto do X-Forwarded-For: é o que o Traefik acrescenta; os anteriores vêm do cliente.
// Zona IPv6 ('%eth0') é recusada, porque o tipo inet do Postgres não a aceita.
function ipDoCliente(req: NextRequest, confiarProxy: boolean): string | null {
  if (!confiarProxy) return null;
  const ultimo = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '';
  return ultimo !== '' && !ultimo.includes('%') && isIP(ultimo) !== 0 ? ultimo : null;
}

// CSP completa (#318; decisão do PO em 10/11): script só com o nonce desta requisição. O Next lê o
// nonce da CSP da requisição e o aplica aos scripts dele no SSR; por isso as páginas com script
// precisam ser dinâmicas (as do sistema leem o cookie). Estilo inline continua liberado, porque as
// telas usam atributos style e <style>; com nonce em style-src, o navegador ignoraria o
// 'unsafe-inline'. O eval só entra em desenvolvimento (o React o usa para depuração). HSTS fica no
// Traefik de hml e prod, não aqui.
function politicaSeguranca(nonce: string, seguro: boolean): string {
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(seguro ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function comSeguranca(r: NextResponse, csp: string): NextResponse {
  r.headers.set('Content-Security-Policy', csp);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'same-origin');
  r.headers.set('Cache-Control', 'no-store');
  return r;
}

export function proxy(req: NextRequest): NextResponse {
  const env = lerEnvAcesso();
  const nomeSessao = nomeCookieSessao(env);
  const { pathname, searchParams } = req.nextUrl;
  const csp = politicaSeguranca(btoa(crypto.randomUUID()), env.seguro);

  if (!PUBLICAS.has(pathname) && !req.cookies.has(nomeSessao)) {
    const metodoSeguro = req.method === 'GET' || req.method === 'HEAD';
    return comSeguranca(NextResponse.redirect(new URL('/login', req.url), metodoSeguro ? 307 : 303), csp);
  }

  const cabecalhos = new Headers(req.headers);
  cabecalhos.delete(CABECALHO_IP);
  // Cabeçalho interno: o do cliente nunca passa; só a rota do aviso o recebe, daqui.
  cabecalhos.delete(CABECALHO_SEM_RENOVACAO);
  if (pathname === ROTA_AVISO) cabecalhos.set(CABECALHO_SEM_RENOVACAO, '1');
  const ip = ipDoCliente(req, env.confiarProxy);
  if (ip) cabecalhos.set(CABECALHO_IP, ip);
  cabecalhos.set('Content-Security-Policy', csp);
  const resposta = comSeguranca(NextResponse.next({ request: { headers: cabecalhos } }), csp);

  // Logoff (Task 4): o cliente sempre termina em /login?saiu=1. Os cookies são limpos aqui, mesmo
  // com a sessão já expirada (RNF0010), mas só quando o pedido vem do próprio sistema: um link de
  // outro site não derruba a sessão. Sem "cookies" no Clear-Site-Data, que alcançaria o domínio
  // registrável inteiro.
  const site = req.headers.get('sec-fetch-site');
  if (pathname === '/login' && searchParams.get('saiu') === '1' && (site === 'same-origin' || site === 'none')) {
    resposta.cookies.set(nomeSessao, '', { maxAge: 0, path: '/', httpOnly: true, secure: env.seguro, sameSite: 'lax' });
    resposta.cookies.set(nomeCookieUnidade(env), '', { maxAge: 0, path: '/', httpOnly: true, secure: env.seguro, sameSite: 'lax' });
    resposta.headers.set('Clear-Site-Data', '"storage"');
  }
  return resposta;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
