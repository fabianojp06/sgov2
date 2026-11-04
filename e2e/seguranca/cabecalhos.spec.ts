import { expect, test, type APIResponse } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Testes de segurança do P7 (Task 4, Step 1; US-116, #138): cabeçalhos, cookie de sessão e acesso
// sem sessão. A CSP completa e o HSTS dependem da frente A (proxy.ts) ou do Traefik: até lá, o teste
// confere o que o proxy promete hoje (plano do P5, Task 2b) e marca a falta como pendência.

function conferirCabecalhos(r: APIResponse): void {
  const h = r.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('same-origin');
  expect(h['cache-control']).toContain('no-store');
}

test('página pública (/login): cabeçalhos de segurança', async ({ request }) => {
  const r = await request.get('/login');
  expect(r.status()).toBe(200);
  conferirCabecalhos(r);
});

test('sem sessão: página protegida e exportação levam ao login, sem conteúdo', async ({ request }) => {
  for (const rota of ['/inicio', '/cad/plano-contas', '/rel/conferencia-carga', '/rel/conferencia-carga/exportar?ano=2027&formato=csv']) {
    const r = await request.get(rota, { maxRedirects: 0 });
    expect(r.status(), rota).toBe(307);
    expect(r.headers()['location'], rota).toMatch(/\/login$/);
    expect(r.headers()['content-disposition'], rota).toBeUndefined();
    conferirCabecalhos(r);
  }
});

test('cookie de sessão: HttpOnly, SameSite=Lax, path / e sessão; página logada com os cabeçalhos', async ({ page, context }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  const cookies = await context.cookies();
  const sessao = cookies.find((c) => c.name === 'sgo_sessao' || c.name === '__Host-sgo_sessao');
  expect(sessao).toBeDefined();
  expect(sessao).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  // O E2E roda em http://127.0.0.1: o Secure (e o prefixo __Host-) só valem com URL_PUBLICA https.
  expect(sessao!.secure).toBe(sessao!.name.startsWith('__Host-'));
  // Nenhum cookie do sistema é legível pelo JavaScript da página.
  expect(cookies.filter((c) => c.name.startsWith('sgo_') || c.name.startsWith('__Host-sgo_')).every((c) => c.httpOnly)).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('sgo_sessao');

  const r = await page.request.get('/inicio');
  expect(r.status()).toBe(200);
  conferirCabecalhos(r);
});

test('página do sistema não abre dentro de um iframe de outro site', async ({ page }) => {
  // frame-ancestors 'none': o navegador recusa o enquadramento, e o login não aparece no iframe.
  await page.setContent('<iframe id="alvo" src="http://127.0.0.1:3190/login" width="600" height="400"></iframe>');
  const quadro = page.frameLocator('#alvo');
  await expect(quadro.getByLabel('Login')).toHaveCount(0, { timeout: 5_000 });
});

test.fixme('sem X-Powered-By (o servidor não revela o framework)', async ({ request }) => {
  // Achado baixo do P7 (Task 4): o Next envia "X-Powered-By: Next.js" por padrão. A correção é
  // poweredByHeader: false no next.config (compartilhado, spec §12.5). Ligar depois dela.
  const r = await request.get('/login');
  expect(r.headers()['x-powered-by']).toBeUndefined();
});

test.fixme('CSP completa (default-src, script-src) e HSTS em hml', async () => {
  // Pendência do P7 (Ordem e dependências): o proxy.ts (frente A) só envia frame-ancestors, e o
  // HSTS vem do Traefik em hml (PO). Ligar este teste quando um dos dois existir.
});
