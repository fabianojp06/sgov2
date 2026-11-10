import { expect, test, type Browser, type Page } from '@playwright/test';
import { BASE, entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Perfis de Usuário (US-037; UC02.07–10, UC02.25/26; plano do P13, Task 2): guarda da página,
// cadastro com a grade (A2 e uma ação retirada), nome repetido sem diferenciar maiúsculas, usuário
// associado ao perfil novo vê o menu dele, a exclusão só depois de desassociar (RN0072). O banco
// volta ao que era: o usuário do teste retorna ao Orçamentista e o perfil é excluído.
const PERFIL = 'Consulta Orçamento';

const tabela = (page: Page) => page.getByRole('table', { name: 'Perfis de Usuário' });

async function abrirLista(page: Page): Promise<void> {
  await page.goto('/inicio');
  await page.getByRole('navigation').getByRole('link', { name: 'Perfis de Usuário' }).click();
  await expect(page).toHaveURL(/\/adm\/perfis$/);
}

// Troca os perfis do usuário do teste pela tela de usuários.
async function trocarPerfis(page: Page, marcar: string, desmarcar: string): Promise<void> {
  await page.goto('/adm/usuarios');
  await page.getByRole('treegrid', { name: 'Usuários' }).getByRole('link', { name: USUARIOS.orcPerfis.nome }).click();
  await page.getByRole('checkbox', { name: marcar, exact: true }).check();
  await page.getByRole('checkbox', { name: desmarcar, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/adm\/usuarios\?aviso=alterado$/);
}

async function menuDoOrcamentista(browser: Browser): Promise<string[]> {
  const contexto = await browser.newContext({ baseURL: BASE });
  try {
    const outra = await contexto.newPage();
    await entrarNaTelaPrincipal(outra, USUARIOS.orcPerfis.login);
    return await outra.getByRole('navigation').getByRole('link').allInnerTexts();
  } finally {
    await contexto.close();
  }
}

test('orçamentista em /adm/perfis recebe 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  expect((await page.goto('/adm/perfis'))?.status()).toBe(404);
  expect((await page.goto('/adm/perfis/novo'))?.status()).toBe(404);
});

test('administrador: cadastra o perfil pela grade, associa um usuário e só exclui depois de desassociar', async ({ page, browser }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.perfis.login);
  await abrirLista(page);

  // Cadastro: marcar o módulo marca tudo (A2); tirar uma ação deixa o módulo indeterminado.
  await page.getByRole('link', { name: 'Novo', exact: true }).click();
  await page.getByLabel('Nome').fill(PERFIL);
  const modulo = page.getByRole('checkbox', { name: 'Administração Central', exact: true });
  await modulo.check();
  const pacotes = page.getByRole('checkbox', { name: 'Excluir em Pacotes base zero' });
  await expect(pacotes).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Consultar em Exercícios' })).toBeChecked();
  // C25 (ajuste A3): o perfil da tela que lança em pacotes não tem CC de escopo.
  await expect(page.getByText('Usuários deste perfil não têm CC de escopo')).toBeVisible();
  await pacotes.uncheck();
  expect(await modulo.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/adm\/perfis\?aviso=cadastrado$/);
  await expect(page.getByRole('status').filter({ hasText: 'Perfil cadastrado com sucesso.' })).toBeVisible();
  await expect(tabela(page).getByRole('row', { name: new RegExp(PERFIL) })).toContainText('Ativo');

  // Nome repetido sem diferenciar maiúsculas (RN0068): o erro aparece e o formulário mantém o digitado.
  await page.getByRole('link', { name: 'Novo', exact: true }).click();
  await page.getByLabel('Nome').fill('consulta orçamento');
  await page.getByRole('checkbox', { name: 'Consultar em Exercícios' }).check();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Já existe um perfil com este nome.' })).toBeVisible();
  await expect(page.getByLabel('Nome')).toHaveValue('consulta orçamento');
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await expect(page).toHaveURL(/\/adm\/perfis$/);

  // O usuário passa a ter só o perfil novo e vê o menu dele, menos o que foi retirado.
  await trocarPerfis(page, PERFIL, 'Orçamentista');
  const menu = await menuDoOrcamentista(browser);
  expect(menu).toEqual(expect.arrayContaining(['Exercícios', 'Pacotes base zero']));

  // Com usuário associado, a exclusão não aparece (RN0072).
  await abrirLista(page);
  await expect(tabela(page).getByRole('row', { name: new RegExp(PERFIL) })).toContainText('1');
  await expect(page.getByRole('button', { name: `Excluir ${PERFIL}` })).toHaveCount(0);

  // Volta ao Orçamentista e exclui o perfil, com confirmação.
  await trocarPerfis(page, 'Orçamentista', PERFIL);
  await abrirLista(page);
  await page.getByRole('button', { name: `Excluir ${PERFIL}` }).click();
  await expect(page.getByRole('alertdialog')).toContainText(`Deseja realmente excluir o perfil ${PERFIL}?`);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/adm\/perfis\?aviso=excluido$/);
  await expect(page.getByRole('status').filter({ hasText: 'Perfil excluído com sucesso.' })).toBeVisible();
  await expect(tabela(page).getByRole('row', { name: new RegExp(PERFIL) })).toHaveCount(0);
});
