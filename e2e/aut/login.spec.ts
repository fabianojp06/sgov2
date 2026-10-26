import { expect, test } from '@playwright/test';
import pg from 'pg';
import { ADMIN_INICIAL, entrar, NOVA_SENHA, SENHA, USUARIOS } from './apoio';

// Login (UC01.01, US-026) e troca obrigatória no primeiro acesso (US-030).
const mensagem = (page: import('@playwright/test').Page) => page.locator('#mensagem-login');

test('senha errada: "Login ou senha inválidos"', async ({ page }) => {
  await entrar(page, 'nao.existe', 'QualquerSenha1');
  await expect(mensagem(page)).toHaveText('Login ou senha inválidos');
  await expect(page).toHaveURL(/\/login/);
});

test('administrador inicial: troca obrigatória e depois a tela principal', async ({ page }) => {
  await entrar(page, ADMIN_INICIAL.login, ADMIN_INICIAL.senha);
  await expect(page).toHaveURL(/\/troca-senha$/);
  await page.getByLabel('Nova senha').fill(NOVA_SENHA);
  await page.getByLabel('Repetir senha').fill(NOVA_SENHA);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
});

test('5 senhas erradas bloqueiam a conta: aviso na última, mensagem genérica e depois o bloqueio (C29, RN0018)', async ({ page }) => {
  for (let i = 1; i <= 5; i++) {
    await entrar(page, USUARIOS.bloqueio.login, `Errada${i}x2026`);
    await expect(mensagem(page)).toContainText('Login ou senha inválidos');
    const aviso = expect(mensagem(page));
    if (i === 4) await aviso.toContainText('Atenção: resta 1 (uma) tentativa antes do bloqueio da conta.');
    else await aviso.not.toContainText('Atenção');
  }
  // A conta já está bloqueada: o bloqueio é avaliado antes da senha, então nem a certa entra.
  await entrar(page, USUARIOS.bloqueio.login, SENHA);
  await expect(mensagem(page)).toHaveText('Usuário bloqueado. Contate o Administrador do sistema.');
});

test('manutenção ligada: "Sistema está em manutenção" para quem não é Administrador', async ({ page }) => {
  const migrator = new pg.Client({ connectionString: process.env.E2E_MIGRATOR_URL });
  await migrator.connect();
  try {
    await migrator.query('UPDATE configuracao_acesso SET manutencao = true');
    await entrar(page, USUARIOS.manutencao.login, SENHA);
    await expect(mensagem(page)).toHaveText('Sistema está em manutenção');
  } finally {
    await migrator.query('UPDATE configuracao_acesso SET manutencao = false');
    await migrator.end();
  }
});
