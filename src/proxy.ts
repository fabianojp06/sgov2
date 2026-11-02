import { isIP } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { lerEnvAcesso, nomeCookieSessao, nomeCookieUnidade } from '@/shared/config';

// Proxy (o middleware do Next 16), da frente A (spec §12.3). Só confere se o cookie existe: quem
// valida a sessão é o provedor de contexto do aut. Também resolve o IP do cliente, limpa os
// cookies no logoff e aplica os cabeçalhos de segurança (plano do P5, Task 2b).
const PUBLICAS = new Set(['/', '/login']);
// O mesmo nome de CABECALHO_IP de @/shared/authz (que carrega o Prisma e fica fora do proxy).
const CABECALHO_IP = 'x-sgo-ip';

// Último salto do X-Forwarded-For: é o que o Traefik acrescenta; os anteriores vêm do cliente.
// Zona IPv6 ('%eth0') é recusada, porque o tipo inet do Postgres não a aceita.
function ipDoCliente(req: NextRequest, confiarProxy: boolean): string | null {
  if (!confiarProxy) return null;
  const ultimo = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? '';
  return ultimo !== '' && !ultimo.includes('%') && isIP(ultimo) !== 0 ? ultimo : null;
}

function comSeguranca(r: NextResponse): NextResponse {
  r.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'same-origin');
  r.headers.set('Cache-Control', 'no-store');
  return r;
}

export function proxy(req: NextRequest): NextResponse {
  const env = lerEnvAcesso();
  const nomeSessao = nomeCookieSessao(env);
  const { pathname, searchParams } = req.nextUrl;

  if (!PUBLICAS.has(pathname) && !req.cookies.has(nomeSessao)) {
    const metodoSeguro = req.method === 'GET' || req.method === 'HEAD';
    return comSeguranca(NextResponse.redirect(new URL('/login', req.url), metodoSeguro ? 307 : 303));
  }

  const cabecalhos = new Headers(req.headers);
  cabecalhos.delete(CABECALHO_IP);
  const ip = ipDoCliente(req, env.confiarProxy);
  if (ip) cabecalhos.set(CABECALHO_IP, ip);
  const resposta = comSeguranca(NextResponse.next({ request: { headers: cabecalhos } }));

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
