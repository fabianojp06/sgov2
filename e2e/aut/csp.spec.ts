import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from './apoio';

// CSP completa (#318; decisão do PO em 10/11): o proxy manda script só com o nonce da requisição, e
// o Next põe esse nonce nos scripts dele. Se a página fosse estática ou o nonce não chegasse ao SSR,
// o navegador bloquearia o JavaScript e acusaria a violação no console.
const TELAS = ['/inicio', '/adm/usuarios', '/adm/alcadas', '/adm/historico'];

test('login e telas do Administrador sem violação de CSP, com o nonce do cabeçalho nos scripts', async ({ page }) => {
  const violacoes: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violacoes.push(`${page.url()}: ${m.text()}`);
  });

  const resposta = await page.goto('/login');
  const csp = resposta?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeDefined();
  // O navegador esconde o atributo nonce do DOM, mas a propriedade guarda o valor.
  const nonces = await page.evaluate(() => [...document.scripts].map((s) => s.nonce));
  expect(nonces.length).toBeGreaterThan(0);
  expect(new Set(nonces)).toEqual(new Set([nonce]));

  await entrarNaTelaPrincipal(page, USUARIOS.csp.login);
  for (const tela of TELAS) {
    await page.goto(tela);
    await page.waitForLoadState('networkidle');
  }
  expect(violacoes).toEqual([]);
});
