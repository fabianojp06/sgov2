import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Telas de usuário (US-038, UC02.11–UC02.13): guarda da página, listagem, cadastro, alteração,
// nova senha e desbloqueio, com as confirmações do UC02.13.
const grade = (page: Page) => page.getByRole('treegrid', { name: 'Usuários' });

async function abrirListagem(page: Page): Promise<void> {
  await entrarNaTelaPrincipal(page, USUARIOS.cadastro.login);
  await page.getByRole('navigation').getByRole('link', { name: 'Usuários' }).click();
  await expect(page).toHaveURL(/\/adm\/usuarios$/);
}

test('orçamentista em /adm/usuarios recebe 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  expect((await page.goto('/adm/usuarios'))?.status()).toBe(404);
  expect((await page.goto('/adm/usuarios/novo'))?.status()).toBe(404);
});

test('administrador: listagem, cadastro, alteração e nova senha com confirmação', async ({ page }) => {
  await abrirListagem(page);
  await expect(grade(page).getByRole('link', { name: USUARIOS.admin.nome })).toBeVisible();
  await expect(grade(page).getByRole('columnheader', { name: 'Status' })).toBeVisible();

  await page.getByRole('link', { name: 'Novo', exact: true }).click();
  await expect(page.getByLabel(/senha/i)).toHaveCount(0); // RN0059
  await page.getByLabel('Nome completo').fill('E2E Novo Usuário');
  await page.getByLabel('E-mail').fill('novo.e2e@example.org');
  await page.getByLabel('Login').fill('novo.e2e');
  await page.getByLabel('Orçamentista').check();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/adm\/usuarios\?aviso=cadastrado$/);
  await expect(page.getByRole('status')).toContainText('Usuário cadastrado com sucesso');

  await grade(page).getByRole('link', { name: 'E2E Novo Usuário' }).click();
  await expect(page.getByLabel('Login')).toBeDisabled(); // RN0066
  await expect(page.getByLabel('Login')).toHaveValue('novo.e2e');
  await page.getByLabel('Nome completo').fill('E2E Novo Alterado');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status')).toHaveText('Alteração no cadastro do usuário realizada com sucesso');

  await grade(page).getByRole('link', { name: 'E2E Novo Alterado' }).click();
  await page.getByRole('button', { name: 'Resetar Senha' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Deseja realmente resetar a senha deste usuário?');
  await page.getByRole('button', { name: 'Não' }).click(); // A8
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resetar Senha' }).click();
  await page.getByRole('button', { name: 'Sim' }).click();
  await expect(page.getByRole('status')).toHaveText('Nova senha gerada e enviada para o e-mail do usuário.');
});

test('erro de validação fica no formulário, sem perder o que foi digitado', async ({ page }) => {
  await abrirListagem(page);
  await page.getByRole('link', { name: 'Novo', exact: true }).click();
  await page.getByLabel('Nome completo').fill('E2E Sem Perfil');
  await page.getByLabel('E-mail').fill('sem.perfil@example.org');
  await page.getByLabel('Login').fill('sem.perfil');
  await page.getByRole('button', { name: 'Salvar' }).click();
  // O Next também mantém um anunciador de rota com role="alert": filtra pelo texto.
  await expect(page.getByRole('alert').filter({ hasText: 'Selecione pelo menos um perfil de acesso' })).toBeVisible();
  await expect(page.getByLabel('Nome completo')).toHaveValue('E2E Sem Perfil');
  await expect(page).toHaveURL(/\/adm\/usuarios\/novo$/);
});

test('usuário bloqueado: mensagem do RN0052 e desbloqueio com confirmação', async ({ page }) => {
  const migrator = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await migrator.connect();
  try {
    await migrator.query('UPDATE usuario SET bloqueado = true, tentativas_falhas = 5 WHERE login = $1', [USUARIOS.desbloqueio.login]);
  } finally {
    await migrator.end();
  }
  await abrirListagem(page);
  await expect(grade(page).getByRole('row', { name: new RegExp(USUARIOS.desbloqueio.nome) })).toContainText('Ativo (bloqueado)');
  await grade(page).getByRole('link', { name: USUARIOS.desbloqueio.nome }).click();
  await expect(page.getByText('Este usuário está bloqueado')).toBeVisible();
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Deseja realmente desbloquear este usuário?');
  await page.getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/adm\/usuarios\?aviso=desbloqueado$/);
  await expect(page.getByRole('status')).toHaveText('Usuário desbloqueado com sucesso');
  await expect(grade(page).getByRole('row', { name: new RegExp(USUARIOS.desbloqueio.nome) })).not.toContainText('bloqueado)');
});
