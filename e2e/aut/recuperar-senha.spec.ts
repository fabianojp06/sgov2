import { expect, test } from '@playwright/test';
import pg from 'pg';
import { entrar, SENHA, urlMigratorDoTeste, USUARIOS } from './apoio';

// Recuperar a senha pela tela de login (US-029, EP084 UC01.01 A1): sem login, a mensagem E5; com
// qualquer login, a mesma resposta (A1.5); para o elegível, a temporária fica pendente e a senha
// vigente continua valendo (RN0517).
const A15 = 'Se o login informado estiver cadastrado com um e-mail válido, uma nova senha será enviada para o e-mail registrado. Caso não a receba, contate o Administrador do sistema.';

test('Esqueci minha senha: E5 sem login; A1.5 para inexistente e para o elegível; a senha vigente continua valendo', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'O campo Login é obrigatório para redefinir a senha' })).toBeVisible();

  await page.getByLabel('Login').fill('ninguem.e2e');
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByRole('status').filter({ hasText: A15 })).toBeVisible();

  await page.getByLabel('Login').fill(USUARIOS.recuperacao.login);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByRole('status').filter({ hasText: A15 })).toBeVisible();

  const banco = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await banco.connect();
  try {
    const r = await banco.query('SELECT recuperacao_hash IS NOT NULL AS pendente FROM usuario WHERE login = $1', [USUARIOS.recuperacao.login]);
    expect(r.rows[0]).toEqual({ pendente: true });
  } finally {
    await banco.end();
  }
  // A senha vigente continua valendo (e o login com ela apaga a temporária pendente).
  await entrar(page, USUARIOS.recuperacao.login, SENHA);
  await expect(page).toHaveURL(/\/inicio$/);
});
