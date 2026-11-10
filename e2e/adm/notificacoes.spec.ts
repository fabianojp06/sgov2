import { expect, test, type Page } from '@playwright/test';
import { entrarNaTelaPrincipal, USUARIOS } from '../aut/apoio';

// Notificações de desempenho (US-041; EP085 UC02.20, grupo "Desempenho"): guarda da página,
// inclusão com limite em vírgula decimal, recusa do duplicado (A3) e do usuário vazio (A2), e
// exclusão com confirmação Sim/Não (A4, A5). O C1 é o plano de contas oficial carregado pela seed.
const grade = (page: Page) => page.getByRole('table', { name: 'Destinatários das notificações de desempenho' });
const CONTA = '4.1.1.1 – DESPESAS DE PESSOAL';

async function adicionar(page: Page, conta: string, limite: string, dias: string, usuario?: string) {
  await page.getByLabel('Conta Sintética').selectOption({ label: conta });
  await page.getByLabel('Limite de Despesa (% do orçado)').fill(limite);
  await page.getByLabel('Frequência de Envio (dias)').fill(dias);
  if (usuario) await page.getByLabel('Usuário').selectOption({ label: usuario });
  await page.getByRole('button', { name: 'Adicionar' }).click();
}

test('orçamentista em /adm/notificacoes recebe 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  expect((await page.goto('/adm/notificacoes'))?.status()).toBe(404);
});

test('administrador: adiciona o destinatário, vê na grade, recusa o duplicado e exclui', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.notificacoes.login);
  await page.getByRole('navigation').getByRole('link', { name: 'Notificações de Desempenho' }).click();
  await expect(page).toHaveURL(/\/adm\/notificacoes$/);

  // Usuário vazio (A2): a mensagem aparece e nada é gravado.
  await adicionar(page, CONTA, '80,5', '30');
  await expect(page.getByText('O usuário é obrigatório.').first()).toBeVisible();

  await page.getByLabel('Usuário').selectOption({ label: USUARIOS.gfin.nome });
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page).toHaveURL(/\/adm\/notificacoes\?aviso=incluida$/);
  const linha = grade(page).getByRole('row').filter({ hasText: CONTA }).filter({ hasText: USUARIOS.gfin.nome });
  await expect(linha).toContainText('80,50%');
  await expect(linha).toContainText('30');

  // "Todas" para o mesmo usuário convive com a conta específica.
  await adicionar(page, 'Todas', '95', '7', USUARIOS.gfin.nome);
  await expect(page).toHaveURL(/\/adm\/notificacoes\?aviso=incluida$/);
  await expect(grade(page).getByRole('row').filter({ hasText: USUARIOS.gfin.nome })).toHaveCount(2);

  // Duplicado usuário + conta (A3).
  await adicionar(page, CONTA, '50', '1', USUARIOS.gfin.nome);
  await expect(page.getByText('Este usuário já recebe a notificação desta conta.').first()).toBeVisible();
  await expect(grade(page).getByRole('row').filter({ hasText: CONTA })).toHaveCount(1);

  // Excluir: Não cancela (A5); Sim exclui (A4).
  await linha.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Não' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await linha.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/adm\/notificacoes\?aviso=excluida$/);
  await expect(grade(page).getByRole('row').filter({ hasText: CONTA })).toHaveCount(0);
  const todas = grade(page).getByRole('row').filter({ hasText: 'Todas' }).filter({ hasText: USUARIOS.gfin.nome });
  await expect(todas).toHaveCount(1);

  // Limpa o "Todas": uma nova tentativa do teste (retry do CI) não esbarra no A3.
  await todas.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/adm\/notificacoes\?aviso=excluida$/);
  await expect(grade(page).getByRole('row').filter({ hasText: USUARIOS.gfin.nome })).toHaveCount(0);
});
