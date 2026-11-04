import { expect, test, type Page } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Alçadas de aprovação (US-042, §11.4): guarda da página, cadastro, troca de aprovador (a linha
// antiga fica inativa na lista) e exclusão com confirmação.
const grade = (page: Page) => page.getByRole('treegrid', { name: 'Alçadas de Aprovação' });

test('orçamentista em /adm/alcadas recebe 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  expect((await page.goto('/adm/alcadas'))?.status()).toBe(404);
});

test('administrador: cadastra a alçada de WA01, troca o titular e exclui', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.alcadas.login);
  await page.getByRole('navigation').getByRole('link', { name: 'Alçadas de Aprovação' }).click();
  await expect(page).toHaveURL(/\/adm\/alcadas$/);

  await page.getByRole('link', { name: 'Novo', exact: true }).click();
  await page.getByLabel('Fluxo').selectOption({ label: 'WA01 – Oficialização de proposta' });
  await page.getByLabel('Titular').selectOption({ label: USUARIOS.gfin.nome });
  // Titular igual ao substituto: o erro aparece no campo e nada é gravado.
  await page.getByLabel('Substituto').selectOption({ label: USUARIOS.gfin.nome });
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Titular e substituto devem ser usuários ativos diferentes.').first()).toBeVisible();
  await page.getByLabel('Substituto').selectOption({ label: USUARIOS.direx.nome });
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/adm\/alcadas\?aviso=cadastrada$/);
  const ativa = grade(page).getByRole('row').filter({ hasText: 'Ativa' }).filter({ hasNotText: 'Inativa' });
  await expect(ativa).toContainText(USUARIOS.gfin.nome);

  await ativa.getByRole('link', { name: /WA01/ }).click();
  await page.getByLabel('Titular').selectOption({ label: USUARIOS.orcamentista.nome });
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/adm\/alcadas\?aviso=alterada$/);
  await expect(grade(page).getByRole('row').filter({ hasText: 'Ativa' }).filter({ hasNotText: 'Inativa' })).toContainText(USUARIOS.orcamentista.nome);
  await expect(grade(page).getByRole('row').filter({ hasText: 'Inativa desde' })).toContainText(USUARIOS.gfin.nome);

  await grade(page).getByRole('row').filter({ hasNotText: 'Inativa' }).getByRole('link', { name: /WA01/ }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/adm\/alcadas\?aviso=excluida$/);
  await expect(grade(page).getByRole('row').filter({ hasText: 'Inativa desde' })).toHaveCount(2);
});
