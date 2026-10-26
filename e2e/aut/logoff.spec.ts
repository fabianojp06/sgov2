import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from './apoio';

// Logoff (UC01.04, US-032): confirmação, volta ao login, sem dados na volta do navegador e sem o
// cookie da sessão (RNF0010).
test('Sair → Sim: login, Voltar não mostra o usuário e o cookie some', async ({ page, context }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.sair.login);
  await expect(page.getByText(USUARIOS.sair.nome)).toBeVisible();

  await page.getByRole('button', { name: 'Sair' }).click();
  const dialogo = page.getByRole('alertdialog');
  await expect(dialogo).toContainText('Deseja realmente sair?');
  await dialogo.getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/login\?saiu=1$/);

  await page.goBack();
  await expect(page.getByText(USUARIOS.sair.nome)).toHaveCount(0);
  expect((await context.cookies()).map((c) => c.name)).not.toContain('sgo_sessao');
});
