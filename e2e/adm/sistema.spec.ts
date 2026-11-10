import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { entrar, entrarNaTelaPrincipal, SENHA, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Ativar e desativar o sistema (US-036, UC02.01; US-033, RN0023, UC02.15; plano do P9, Task 2). O
// estado do sistema é global: cada teste o devolve ativo, com a espera padrão, no finally.
const grade = (page: Page) => page.getByRole('treegrid', { name: 'Histórico de ativações e desativações' });
const AVISO_CONTAGEM = /O sistema será desativado em \d+ minutos\. Por favor, salve seus trabalhos correntes\./;

async function comBanco(executar: (migrator: pg.Client) => Promise<void>): Promise<void> {
  const migrator = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await migrator.connect();
  try {
    await executar(migrator);
  } finally {
    await migrator.query(
      'UPDATE configuracao_acesso SET manutencao = false, manutencao_a_partir = NULL, manutencao_motivo = NULL, manutencao_por = NULL, desconexao_espera_min = 5',
    );
    await migrator.end();
  }
}

async function estacao(browser: Browser, login: string): Promise<{ page: Page; fechar: () => Promise<void> }> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrarNaTelaPrincipal(page, login);
  return { page, fechar: () => contexto.close() };
}

async function abrirTela(page: Page): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Ativar/Desativar Sistema' }).click();
  await expect(page).toHaveURL(/\/adm\/sistema$/);
  await expect(page.getByRole('heading', { name: 'Ativação e Desativação do Sistema' })).toBeVisible();
}

async function desativar(page: Page, motivo: string): Promise<void> {
  await page.getByRole('button', { name: 'Desativar' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Deseja realmente desativar o sistema?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  const modal = page.getByRole('dialog');
  // E1 (RN0073): sem motivo, a mensagem aparece e o modal continua aberto.
  await modal.getByRole('button', { name: 'OK' }).click();
  await expect(modal.getByText('Você deve informar o motivo da desativação do sistema.')).toBeVisible();
  await modal.getByLabel('Motivo da desativação').fill(motivo);
  await modal.getByRole('button', { name: 'OK' }).click();
}

async function ativar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Deseja realmente ativar o sistema?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
  await expect(page).toHaveURL(/\/adm\/sistema\?aviso=ativado$/);
  await expect(page.getByRole('status').filter({ hasText: 'O sistema foi ativado com sucesso.' })).toBeVisible();
  await expect(page.getByText('O sistema encontra-se atualmente ATIVO')).toBeVisible();
}

test('orçamentista em /adm/sistema recebe 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  expect((await page.goto('/adm/sistema'))?.status()).toBe(404);
});

test('desativar sem espera: o orçamentista conectado cai com "Sistema está em manutenção"; o administrador fica só com a Administração e reativa', async ({ browser }) => {
  await comBanco(async (migrator) => {
    await migrator.query('UPDATE configuracao_acesso SET desconexao_espera_min = 0');
    const orc = await estacao(browser, USUARIOS.sistemaOrc.login);
    const adm = await estacao(browser, USUARIOS.sistema.login);
    try {
      await abrirTela(adm.page);
      await expect(adm.page.getByText('O sistema encontra-se atualmente ATIVO')).toBeVisible();
      await expect(adm.page.getByRole('button', { name: 'Ativar', exact: true })).toBeDisabled();
      await desativar(adm.page, 'Virada do exercício (E2E)');
      await expect(adm.page).toHaveURL(/\/adm\/sistema\?aviso=desativado$/);
      await expect(adm.page.getByRole('status').filter({ hasText: 'O sistema foi desativado com sucesso.' })).toBeVisible();
      await expect(adm.page.getByText('O sistema encontra-se atualmente INATIVO')).toBeVisible();
      await expect(adm.page.getByRole('button', { name: 'Desativar' })).toBeDisabled();

      // O orçamentista já conectado cai na próxima interação (UC02.15) e não entra de novo (RN0023).
      await orc.page.goto('/inicio');
      await expect(orc.page).toHaveURL(/\/login\?motivo=sistema-inativo$/);
      await expect(orc.page.getByRole('alert').filter({ hasText: 'Sistema está em manutenção' })).toBeVisible();
      await entrar(orc.page, USUARIOS.sistemaOrc.login, SENHA);
      await expect(orc.page.locator('#mensagem-login')).toHaveText('Sistema está em manutenção');

      // Quem desativou continua, só com a Administração (RN0060), e sem o aviso da contagem.
      await adm.page.goto('/inicio');
      await expect(adm.page).toHaveURL(/\/inicio$/);
      await expect(adm.page.getByRole('navigation').getByRole('heading', { level: 2 })).toHaveText(['Administração']);
      await expect(adm.page.getByText(AVISO_CONTAGEM)).toHaveCount(0);

      await abrirTela(adm.page);
      await ativar(adm.page);
      const linhas = grade(adm.page).getByRole('row').filter({ hasText: /Ativação|Desativação/ });
      await expect(linhas.nth(0)).toContainText('Ativação');
      await expect(linhas.nth(1)).toContainText('Desativação');
      await expect(linhas.nth(1)).toContainText('Virada do exercício (E2E)');
      await expect(linhas.nth(1)).toContainText(USUARIOS.sistema.nome);

      // Reativado, o orçamentista entra de novo.
      await entrar(orc.page, USUARIOS.sistemaOrc.login, SENHA);
      await expect(orc.page).toHaveURL(/\/inicio$/);
    } finally {
      await Promise.all([orc.fechar(), adm.fechar()]);
    }
  });
});

test('desativar com espera: os outros veem o aviso com a contagem, quem desativou não; Ativar cancela', async ({ browser }) => {
  await comBanco(async () => {
    const orc = await estacao(browser, USUARIOS.sistemaOrc.login);
    const adm = await estacao(browser, USUARIOS.sistema.login);
    try {
      await abrirTela(adm.page);
      await desativar(adm.page, 'Manutenção programada (E2E)');
      await expect(adm.page).toHaveURL(/\/adm\/sistema\?aviso=agendado$/);
      await expect(adm.page.getByRole('status').filter({ hasText: /A desativação do sistema foi agendada para \d{2}:\d{2}\./ })).toBeVisible();
      await expect(adm.page.getByText('O sistema encontra-se atualmente ATIVO')).toBeVisible();
      await expect(adm.page.getByText(/A desativação do sistema está agendada para \d{2}:\d{2}\./)).toBeVisible();
      await expect(adm.page.getByRole('button', { name: 'Desativar' })).toBeDisabled();
      await expect(adm.page.getByText(AVISO_CONTAGEM)).toHaveCount(0);

      await orc.page.goto('/inicio');
      await expect(orc.page.getByRole('alert').filter({ hasText: 'O sistema será desativado em 5 minutos. Por favor, salve seus trabalhos correntes.' })).toBeVisible();
      // A consulta do aviso responde JSON com os segundos.
      const r = await orc.page.request.get('/aut/aviso');
      expect(r.status()).toBe(200);
      expect((await r.json()).segundos).toBeGreaterThan(0);

      await ativar(adm.page);
      await orc.page.goto('/inicio');
      await expect(orc.page).toHaveURL(/\/inicio$/);
      await expect(orc.page.getByText(AVISO_CONTAGEM)).toHaveCount(0);
      expect((await (await orc.page.request.get('/aut/aviso')).json()).segundos).toBeNull();
    } finally {
      await Promise.all([orc.fechar(), adm.fechar()]);
    }
  });
});
