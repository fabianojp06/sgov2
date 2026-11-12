import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';
import { ccAnaliticoSob } from './planilhas';

// Posições de pessoal pela tela (US-056; plano do P12, Task 2), com o C1 e o C2 reais. Roda depois de
// orcamento.spec.ts (2027 oficializado): a GFIN cria um exercício próprio, o Gestor da DEP (escopo
// 4.1) inclui e altera uma posição com a prévia do servidor, a DIREX (só consulta) vê o salário e o
// anual mascarados, o Gestor exclui, e o afterAll apaga o exercício e os parâmetros do ano.
const ANO = 2032;
const CC_DEP = ccAnaliticoSob('4.1');
const CC_DAF = ccAnaliticoSob('4.3');
const CARGO = 'Analista de orçamento E2E';
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu' });
const valorDa = (page: Page, termo: string) => page.locator(`dt:text-is("${termo}") + dd`);
const linhaDa = (page: Page) => page.getByRole('row', { name: new RegExp(`^${CARGO} `) });

async function confirmar(page: Page, botao: string): Promise<void> {
  await page.getByRole('button', { name: botao }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
}

test.describe.serial(`posições de pessoal ${ANO}`, () => {
  test.afterAll(async () => {
    // Deixa o banco do teste como estava (o Histórico é imutável e fica). As tabelas por ano da frente
    // B são as que a criação do exercício preenche (garantirPremissasExercicio do cad), como no
    // pacotes.spec.ts.
    const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      const ex = `(SELECT id FROM orc_exercicio WHERE ano = ${ANO})`;
      await cliente.query(`DELETE FROM orc_linha WHERE exercicio_id IN ${ex}`);
      await cliente.query(`DELETE FROM orc_pacote WHERE exercicio_id IN ${ex}`);
      await cliente.query(`DELETE FROM orc_posicao WHERE exercicio_id IN ${ex}`);
      await cliente.query(`DELETE FROM orc_exercicio WHERE ano = ${ANO}`);
      for (const tabela of ['beneficio_cargo', 'beneficio_mestre', 'encargo_exercicio', 'conta_componente_exercicio', 'parametros_exercicio']) {
        await cliente.query(`DELETE FROM ${tabela} WHERE ano = ${ANO}`);
      }
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      await cliente.end();
    }
  });

  test('1. GFIN cria o exercício em branco', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gfin.login);
    await page.goto('/orc/exercicios/novo');
    await page.getByRole('spinbutton', { name: 'Ano' }).fill(String(ANO));
    await page.getByLabel('Em branco').check();
    await page.getByRole('button', { name: 'Criar exercício' }).click();
    await expect(page).toHaveURL(/\/orc\/exercicios\?aviso=criado$/);
  });

  test('2. Gestor da DEP inclui uma posição com a prévia do servidor e a altera; CC de outra diretoria não aparece', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gestor.login);
    await menu(page).getByRole('link', { name: 'Posições de pessoal' }).click();
    await expect(page).toHaveURL(/\/orc\/posicoes$/);
    await expect(page.getByRole('heading', { name: `Posições de pessoal (${ANO})` })).toBeVisible();
    const escolha = page.locator('#posicoes-cc');
    await expect(escolha.locator(`option[value="${CC_DEP}"]`)).toHaveCount(1);
    await expect(escolha.locator(`option[value="${CC_DAF}"]`)).toHaveCount(0);

    await page.goto(`/orc/posicoes?ano=${ANO}&cc=${CC_DEP}`);
    await expect(page.getByText('Nenhuma posição neste centro de custo.')).toBeVisible();
    await expect(page.getByText('Preencha a quantidade, o salário mensal e os meses de início e de saída para ver a prévia.')).toBeVisible();
    await page.getByLabel('Cargo').fill(CARGO);
    await page.getByLabel(/^Quantidade/).fill('2');
    await page.getByLabel('Salário mensal (R$)').fill('5.000,00');
    await page.getByLabel('Mês de início').selectOption({ label: 'Janeiro' });
    await page.getByLabel('Mês de saída').selectOption({ label: 'Março' });
    // Prévia do servidor: antes da data-base (maio), massa = 2 × 5.000,00 × 3 meses; férias + 1/3 =
    // 10.000,00 × 4/36 e 13º = 10.000,00 / 12, arredondados mês a mês.
    await expect(page.getByText(/^Custo anual: R\$ /)).toBeVisible();
    await expect(valorDa(page, 'Massa salarial')).toHaveText('R$ 30.000,00');
    await expect(valorDa(page, 'Férias + 1/3 e 13º')).toHaveText('R$ 5.833,32');
    const anual = (await valorDa(page, 'Custo anual').textContent())!.replace('R$ ', '');
    await page.getByRole('button', { name: 'Incluir posição' }).click();
    await expect(page).toHaveURL(new RegExp(`/orc/posicoes\\?ano=${ANO}&cc=${CC_DEP.replaceAll('.', '\\.')}&aviso=incluido$`));
    await expect(page.getByText('Posição incluída. O orçamento foi recalculado.')).toBeVisible();
    // Prévia = gravado (mesmo motor, mesmas premissas).
    await expect(linhaDa(page)).toContainText('5.000,00');
    await expect(linhaDa(page)).toContainText(anual);
    await expect(linhaDa(page)).toContainText('janeiro a março');
    await expect(linhaDa(page)).toContainText('Tela');

    await page.getByRole('link', { name: `Alterar posição 1: ${CARGO}` }).click();
    await expect(page.getByRole('heading', { name: 'Alterar posição' })).toBeVisible();
    await expect(linhaDa(page)).toHaveAttribute('aria-current', 'true');
    await page.getByLabel(/^Quantidade/).fill('3');
    await expect(valorDa(page, 'Massa salarial')).toHaveText('R$ 45.000,00');
    await page.getByRole('button', { name: 'Salvar alteração' }).click();
    await expect(page.getByText('Posição alterada. O orçamento foi recalculado.')).toBeVisible();
    await expect(linhaDa(page).getByRole('cell').first()).toHaveText('3'); // quantidade
  });

  test('3. DIREX (só consulta) vê a posição com salário e anual mascarados, sem ações nem formulário', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.direx.login);
    await page.goto(`/orc/posicoes?ano=${ANO}&cc=${CC_DEP}`);
    await expect(linhaDa(page)).toContainText('•••');
    await expect(linhaDa(page)).not.toContainText('5.000,00');
    await expect(page.getByRole('heading', { name: 'Nova posição' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Alterar posição/ })).toHaveCount(0);
  });

  test('4. Gestor da DEP exclui a posição', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gestor.login);
    await page.goto(`/orc/posicoes?ano=${ANO}&cc=${CC_DEP}`);
    await confirmar(page, `Excluir posição 1: ${CARGO}`);
    await expect(page.getByText('Posição excluída. O orçamento foi recalculado.')).toBeVisible();
    await expect(page.getByText('Nenhuma posição neste centro de custo.')).toBeVisible();
  });
});
