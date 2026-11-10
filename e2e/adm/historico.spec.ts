import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Histórico de Operações (US-040, UC02.24): o Administrador filtra pelo próprio login e vê o login de
// hoje, exporta o XLSX; o Auditor também consulta; o orçamentista recebe 404.
test('administrador filtra pelo próprio login, vê o login de hoje e exporta', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.historico.login);
  await page.getByRole('navigation').getByRole('link', { name: 'Histórico de Operações' }).click();
  await expect(page).toHaveURL(/\/adm\/historico$/);
  await expect(page.getByRole('link', { name: 'Novo' })).toHaveCount(0);

  const filtros = page.getByRole('form', { name: 'Filtros do Histórico' });
  await filtros.getByLabel('Usuário').fill(USUARIOS.historico.login);
  await filtros.getByLabel('Tipo de Operação').selectOption({ label: 'Login' });
  await filtros.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).toHaveURL(/tipo=LOGIN/);
  const linha = page.getByRole('row').filter({ hasText: 'Login realizado' });
  await expect(linha.first()).toContainText(USUARIOS.historico.login);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar' }).click();
  expect((await download).suggestedFilename()).toMatch(/^historico-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('auditor consulta o Histórico; orçamentista recebe 404', async ({ page, browser }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.auditor.login);
  expect((await page.goto('/adm/historico'))?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Histórico de Operações' })).toBeVisible();
  const outro = await browser.newContext();
  try {
    const p = await outro.newPage();
    await entrarNaTelaPrincipal(p, USUARIOS.orcamentista.login);
    expect((await p.goto('/adm/historico'))?.status()).toBe(404);
  } finally {
    await outro.close();
  }
});
