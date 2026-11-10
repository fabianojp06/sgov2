import { expect, test, type Page } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from './apoio';

// CSP completa (#318; decisão do PO em 10/11): o proxy manda script só com o nonce da requisição, e
// o Next põe esse nonce nos scripts dele. Se a página fosse estática ou o nonce não chegasse ao SSR,
// o navegador bloquearia o JavaScript e acusaria a violação no console.
const TELAS = ['/inicio', '/adm/usuarios', '/adm/alcadas', '/adm/perfis', '/adm/historico'];

// Abre a tela e confere que todo <script> do HTML do servidor traz o nonce da CSP desta resposta. Os
// scripts que o Next injeta depois, pelo carregador de chunks, valem pelo 'strict-dynamic' e ficam
// cobertos pela ausência de violação no console.
async function abrirComNonce(page: Page, tela: string): Promise<void> {
  const resposta = await page.goto(tela);
  const nonce = /'nonce-([^']+)'/.exec(resposta?.headers()['content-security-policy'] ?? '')?.[1];
  expect(nonce, tela).toBeDefined();
  const scripts = (await resposta!.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length, tela).toBeGreaterThan(0);
  expect(scripts.filter((s) => !s.includes(`nonce="${nonce}"`)), tela).toEqual([]);
  await page.waitForLoadState('networkidle');
}

test('login e telas do Administrador sem violação de CSP, com o nonce do cabeçalho nos scripts', async ({ page }) => {
  const violacoes: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violacoes.push(`${page.url()}: ${m.text()}`);
  });

  await abrirComNonce(page, '/login');
  await entrarNaTelaPrincipal(page, USUARIOS.csp.login);
  for (const tela of TELAS) await abrirComNonce(page, tela);
  expect(violacoes).toEqual([]);
});
