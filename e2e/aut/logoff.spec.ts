import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from './apoio';

// Logoff (UC01.04, US-032): confirmação, volta ao login, sem dados na volta do navegador, sem o
// cookie e com a sessão encerrada no servidor (RNF0010, RN0522).
test('Sair → Sim: login, Voltar não mostra o usuário, cookie some e a sessão morre no servidor', async ({ page, context }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.sair.login);
  await expect(page.getByText(USUARIOS.sair.nome)).toBeVisible();
  const sessao = (await context.cookies()).find((c) => c.name === 'sgo_sessao');
  expect(sessao).toBeDefined();

  await page.getByRole('button', { name: 'Sair' }).click();
  const dialogo = page.getByRole('alertdialog');
  await expect(dialogo).toContainText('Deseja realmente sair?');
  await dialogo.getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/login\?saiu=1$/);
  expect((await context.cookies()).map((c) => c.name)).not.toContain('sgo_sessao');

  // O Sair troca a entrada de /inicio no histórico (location.replace): Voltar cai no /login. Abrir
  // /inicio de novo, sem o cookie, também vai para o login.
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(USUARIOS.sair.nome)).toHaveCount(0);

  // Com o cookie antigo de volta, a sessão já não existe no servidor.
  await context.addCookies([sessao!]);
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(USUARIOS.sair.nome)).toHaveCount(0);
});
