import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Proposta de TP pela tela (US-065; plano do P17, Task 2, Step 3), com nova versão e duplicar (US-066; plano
// do P18, Task 2, Step 3).
//
// Usa a estrutura sintética de CCs de TP da seed de referência da frente B (raiz 9, analíticos 9.1 a 9.3,
// #438).
//
// Roteiro: o Orçamentista cria a proposta com o CC 9.1; ela aparece na lista em Rascunho, com o valor
// global 0,00; o seletor de unidade da tela principal passa a mostrar o TP (o criador é vinculado na
// criação, D-P17-3); o Orçamentista cria a Versão 2 e duplica a proposta para o TP-E2E-002, com o CC 9.2;
// a proposta é excluída pela confirmação do UC 3.07; e o CC 9.1 volta ao seletor de CC livre (D-P17-10).
// O afterAll apaga as capas, as versões, os vínculos e as unidades dos dois TPs (o Histórico fica).
//
// Usuário: o Orçamentista E2E de e2e/aut/apoio.ts (orc.menu), que outros specs também usam. O vínculo
// com a unidade fica depois da exclusão lógica (D-P17-10); o afterAll o apaga para não mudar o seletor
// de unidade dos outros specs. Se a ordem dos specs atrapalhar, crie um Orçamentista próprio em
// USUARIOS (por exemplo, orc.propostas).
const NUMERO = 'TP-E2E-001';
const OBJETO = 'Proposta E2E de apoio à gestão';
const CC = '9.1';
const NUMERO_COPIA = 'TP-E2E-002';
const CC_COPIA = '9.2';
const usuario = USUARIOS.orcamentista;
const linhaDa = (page: Page, numero = NUMERO) => page.getByRole('row', { name: new RegExp(`^${numero} `) });
// Colunas de dados da linha (o número é o cabeçalho da linha): Tipo, Objeto, Categoria, Vigência, CC, Versão.
const versaoDa = (page: Page, numero = NUMERO) => linhaDa(page, numero).getByRole('cell').nth(5);
const opcoesDoCc = (page: Page) => page.getByLabel('Centro de custo').locator('option');

test.describe.serial('proposta de TP', () => {

  test.afterAll(async () => {
    const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
    await cliente.connect();
    try {
      await cliente.query('BEGIN');
      const codigos = `('${NUMERO}', '${NUMERO_COPIA}')`;
      const unidade = `(SELECT id FROM unidade WHERE codigo IN ${codigos})`;
      await cliente.query(`DELETE FROM orc_versao_proposta WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM orc_proposta WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM usuario_unidade WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM unidade WHERE codigo IN ${codigos}`);
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      await cliente.end();
    }
  });

  test('1. o Orçamentista cria a proposta com o CC 9.1 e ela aparece em Rascunho', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto('/orc/propostas');
    await expect(opcoesDoCc(page).filter({ hasText: new RegExp(`^${CC.replace('.', '\\.')} – `) })).toHaveCount(1);
    await page.getByLabel('Tipo').selectOption('TERMO_PARCERIA');
    await page.getByLabel('Número do TP').fill(NUMERO);
    await page.getByLabel('Nome/Objeto').fill(OBJETO);
    await page.getByLabel('Data de início').fill('2027-01-01');
    await page.getByLabel('Data de término').fill('2027-12-31');
    await page.getByLabel('Categoria').selectOption('CONSOLIDADA');
    await page.getByLabel('Centro de custo').selectOption(CC);
    await expect(page.getByLabel('Valor global (R$)')).toHaveValue('0,00');
    await page.getByRole('button', { name: 'Criar proposta' }).click();
    await expect(page).toHaveURL(/\/orc\/propostas\?aviso=incluida&tp=/);
    await expect(page.getByText(`Proposta do TP ${NUMERO} criada em Rascunho.`)).toBeVisible();
    const linha = linhaDa(page);
    await expect(linha).toContainText('Termo de Parceria');
    await expect(linha).toContainText('01/01/2027 a 31/12/2027');
    await expect(linha).toContainText(CC);
    await expect(linha).toContainText('Rascunho');
    await expect(linha).toContainText('0,00');
    await expect(versaoDa(page)).toHaveText('1');
    // O CC deixou de estar livre.
    await expect(opcoesDoCc(page).filter({ hasText: new RegExp(`^${CC.replace('.', '\\.')} – `) })).toHaveCount(0);
  });

  test('2. o seletor de unidade da tela principal mostra o TP', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    // Com um TP só, o nome aparece sem seletor; com mais de um, como opção do "Termo de Parceria".
    await expect(page.locator('.sgo-unidade').first()).toContainText(OBJETO);
  });

  test('3. o Orçamentista cria a Versão 2 e duplica a proposta para o TP-E2E-002 com o CC 9.2', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto('/orc/propostas');
    await page.getByRole('button', { name: `Nova versão da proposta ${NUMERO}` }).click();
    const caixa = page.getByRole('alertdialog');
    await expect(caixa).toContainText(`Deseja realmente criar uma nova versão da proposta do TP ${NUMERO}?`);
    await caixa.getByRole('button', { name: 'Sim' }).click();
    await expect(page).toHaveURL(/\/orc\/propostas\?aviso=versao&tp=/);
    await expect(page.getByText(`Nova versão da proposta do TP ${NUMERO} criada em Rascunho.`)).toBeVisible();
    await expect(versaoDa(page)).toHaveText('2');
    await expect(linhaDa(page)).toContainText('Rascunho');

    await page.getByRole('link', { name: `Duplicar a proposta ${NUMERO}` }).click();
    await expect(page).toHaveURL(/\/orc\/propostas\?duplicar=/);
    await expect(page.getByRole('heading', { name: `Duplicar a proposta do TP ${NUMERO}` })).toBeVisible();
    await expect(page.getByLabel('Nome/Objeto')).toHaveValue(`Cópia de ${OBJETO}`);
    await expect(page.getByLabel('Tipo')).toHaveValue('TERMO_PARCERIA');
    await expect(page.getByLabel('Data de início')).toHaveValue('2027-01-01');
    await expect(page.getByLabel('Número do TP')).toHaveValue('');
    // O CC da origem está ocupado: não aparece entre os livres.
    await expect(opcoesDoCc(page).filter({ hasText: new RegExp(`^${CC.replace('.', '\\.')} – `) })).toHaveCount(0);
    await page.getByLabel('Número do TP').fill(NUMERO_COPIA);
    await page.getByLabel('Centro de custo').selectOption(CC_COPIA);
    await page.getByRole('button', { name: 'Duplicar proposta' }).click();
    await expect(page).toHaveURL(/\/orc\/propostas\?aviso=duplicada&tp=/);
    await expect(page.getByText(`Proposta do TP ${NUMERO_COPIA} criada em Rascunho, por duplicação.`)).toBeVisible();
    // As duas na lista: a origem na Versão 2 e a cópia na Versão 1, com o CC próprio.
    await expect(versaoDa(page)).toHaveText('2');
    const copia = linhaDa(page, NUMERO_COPIA);
    await expect(copia).toContainText(`Cópia de ${OBJETO}`);
    await expect(copia).toContainText(CC_COPIA);
    await expect(copia).toContainText('Rascunho');
    await expect(versaoDa(page, NUMERO_COPIA)).toHaveText('1');
  });

  test('4. a proposta é excluída pela confirmação e o CC volta a ficar livre', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto('/orc/propostas');
    await page.getByRole('button', { name: `Excluir a proposta ${NUMERO}` }).click();
    const caixa = page.getByRole('alertdialog');
    await expect(caixa).toContainText('Deseja realmente excluir esta versão de Proposta?');
    await caixa.getByRole('button', { name: 'Sim' }).click();
    await expect(page).toHaveURL(/\/orc\/propostas\?aviso=excluida&tp=/);
    await expect(page.getByText(`Proposta do TP ${NUMERO} excluída.`)).toBeVisible();
    await expect(linhaDa(page)).toHaveCount(0);
    await expect(opcoesDoCc(page).filter({ hasText: new RegExp(`^${CC.replace('.', '\\.')} – `) })).toHaveCount(1);
  });
});
