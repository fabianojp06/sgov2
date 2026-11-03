import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from './apoio';

// Tela principal (UC01.03, US-031): menu só do que o perfil permite (R11, RN0521) e 1280×720 sem
// rolagem (RNF0008).
test.use({ viewport: { width: 1280, height: 720 } });

test('administrador: Administração › Operadores e Permissões › Usuários, sem rolagem a 1280×720', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.admin.login);
  const menu = page.getByRole('navigation');
  await expect(menu.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Usuários' })).toBeVisible();
  await expect(page.getByText(USUARIOS.admin.nome)).toBeVisible();
  const { largura, altura } = await page.evaluate(() => ({
    largura: document.documentElement.scrollWidth,
    altura: document.documentElement.scrollHeight,
  }));
  expect(largura).toBeLessThanOrEqual(1280);
  expect(altura).toBeLessThanOrEqual(720);
});

// Com as seeds do cad e do orc, todo perfil padrão recebe alguma funcionalidade: o cenário usa um
// perfil criado só no banco do teste, sem permissões (US-037).
test('perfil sem funcionalidade: mensagem do RN0521 e nenhum item de menu', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.semPermissao.login);
  await expect(page.getByText('Nenhuma funcionalidade disponível para o seu perfil de acesso. Contate o Administrador.')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
});
