import { expect, test } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Demonstrativos do TP (US-096): as telas abrem para a GFIN, com o TP obrigatório (RN0234) e sem relatório
// antes da escolha. O cálculo é coberto pelos testes de unidade e de integração; aqui, a página, o menu e a
// recusa de quem não tem o perfil.
test('GFIN: demonstrativo de despesas e de receitas e despesas pedem o TP antes de mostrar o relatório', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.gfinPlano.login);
  for (const [rota, titulo] of [
    ['/rel/despesas-tp', 'Demonstrativo de despesas do TP'],
    ['/rel/receitas-despesas-tp', 'Demonstrativo de receitas e despesas do TP'],
  ] as const) {
    await page.goto(rota);
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
    await expect(page.getByLabel('Termo de Parceria')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  }
});

test('Orçamentista: sem o perfil, os demonstrativos não abrem', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  for (const rota of ['/rel/despesas-tp', '/rel/receitas-despesas-tp']) {
    await page.goto(rota);
    await expect(page.getByRole('heading', { level: 1, name: /Demonstrativo/ })).toHaveCount(0);
  }
});
