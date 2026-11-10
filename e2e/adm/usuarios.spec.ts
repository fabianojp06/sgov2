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

test('administrador: id inexistente ou fora do formato dá 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.cadastro.login);
  expect((await page.goto('/adm/usuarios/00000000-0000-4000-8000-000000000000'))?.status()).toBe(404);
  expect((await page.goto('/adm/usuarios/x'))?.status()).toBe(404);
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
  await expect(page.getByRole('button', { name: 'Não' })).toBeFocused(); // a opção segura
  await page.getByRole('button', { name: 'Não' }).click(); // A8
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resetar Senha' })).toBeFocused();
  await page.getByRole('button', { name: 'Resetar Senha' }).click();
  await page.keyboard.press('Escape');
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

// US-039 (UC02.13 A4–A6, REQ0080): o Administrador retira de um usuário uma funcionalidade do perfil
// dele; o usuário entra sem ela no menu e recebe 404 na rota; devolver a traz de volta.
test('exceção de permissão: retirar e devolver uma funcionalidade do perfil', async ({ browser }) => {
  const funcionalidade = 'Centros de Custo';
  const painel = (page: Page) =>
    page.getByRole('group', { name: 'Funcionalidade(s) do Perfil' }).getByRole('group', { name: 'Orçamentista', exact: true });

  async function editar(marcar: boolean): Promise<void> {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      await entrarNaTelaPrincipal(page, USUARIOS.excecoes.login);
      await page.getByRole('navigation').getByRole('link', { name: 'Usuários' }).click();
      await grade(page).getByRole('link', { name: USUARIOS.orcExcecoes.nome }).click();
      const caixa = painel(page).getByRole('checkbox', { name: funcionalidade });
      await expect(caixa).toBeChecked({ checked: !marcar });
      // Pelo teclado (acessibilidade): foco na caixa e espaço.
      await caixa.focus();
      await page.keyboard.press('Space');
      await expect(caixa).toBeChecked({ checked: marcar });
      await expect(page.getByLabel('Orçamentista', { exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Salvar' }).click();
      await expect(page.getByRole('status')).toHaveText('Alteração no cadastro do usuário realizada com sucesso');
    } finally {
      await contexto.close();
    }
  }

  async function conferirAcesso(tem: boolean): Promise<void> {
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    try {
      await entrarNaTelaPrincipal(page, USUARIOS.orcExcecoes.login);
      const menu = page.getByRole('navigation');
      await expect(menu.getByRole('link', { name: 'Plano de Contas' })).toBeVisible();
      await expect(menu.getByRole('link', { name: funcionalidade })).toHaveCount(tem ? 1 : 0);
      expect((await page.goto('/cad/centros-custo'))?.status()).toBe(tem ? 200 : 404);
    } finally {
      await contexto.close();
    }
  }

  await conferirAcesso(true);
  await editar(false);
  await conferirAcesso(false);
  await editar(true);
  await conferirAcesso(true);
});

// REQ0081 no formulário (ajustes B1 e B2 da revisão 12.12): desmarcar todas as funcionalidades do
// perfil desmarca o perfil, com o foco na caixa dele e o aviso anunciado; remarcado, volta tudo marcado.
test('exceção de permissão: desmarcar todas as funcionalidades desmarca o perfil (REQ0081)', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.excecoes.login);
  await page.goto('/adm/usuarios/novo');
  const perfil = page.getByLabel('Orçamentista', { exact: true });
  await perfil.check();
  const grupo = page.getByRole('group', { name: 'Funcionalidade(s) do Perfil' }).getByRole('group', { name: 'Orçamentista', exact: true });
  const caixas = await grupo.getByRole('checkbox').all();
  expect(caixas.length).toBeGreaterThan(1);
  for (const caixa of caixas.slice(0, -1)) await caixa.uncheck();
  await expect(perfil).toBeChecked();
  await caixas.at(-1)!.click();
  await expect(perfil).not.toBeChecked();
  await expect(perfil).toBeFocused();
  await expect(page.getByText('Perfil Orçamentista desmarcado: todas as funcionalidades foram retiradas.')).toBeVisible();
  await expect(grupo).toHaveCount(0);

  await perfil.check();
  await expect(grupo.getByRole('checkbox')).toHaveCount(caixas.length);
  for (const caixa of await grupo.getByRole('checkbox').all()) await expect(caixa).toBeChecked();
});
