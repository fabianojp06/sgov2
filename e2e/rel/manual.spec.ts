import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Manual do usuário por perfil (US-118): cada pessoa vê só o que o perfil permite, com as ações e o
// roteiro de treinamento.
test('administrador: manual com Usuários, as ações permitidas e o roteiro', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.admin.login);
  await page.goto('/rel/manual');
  await expect(page.getByRole('heading', { level: 1, name: 'Manual do usuário' })).toBeVisible();
  const usuarios = page.getByRole('article', { name: 'Usuários' });
  await expect(usuarios.getByRole('link', { name: 'Usuários' })).toHaveAttribute('href', '/adm/usuarios');
  await expect(usuarios.getByText(/^Você pode: consultar/)).toBeVisible();
  const roteiro = page.getByRole('region', { name: 'Roteiro de treinamento' });
  await expect(roteiro.getByRole('link', { name: 'Usuários' })).toBeVisible();
});

test('orçamentista: o manual não mostra o que o perfil não acessa', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  await page.goto('/rel/manual');
  await expect(page.getByRole('heading', { level: 1, name: 'Manual do usuário' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Usuários' })).toHaveCount(0);
  await expect(page.getByRole('article').first()).toBeVisible();
});
