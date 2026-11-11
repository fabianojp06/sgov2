import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';
import { ccAnaliticoSob, contaAnaliticaSob } from './planilhas';

// Pacotes base zero pela tela (US-057; plano do P11, Task 2), com o C1 e o C2 reais. Roda depois de
// orcamento.spec.ts (2027 oficializado): a GFIN cria um exercício próprio, o Gestor da DEP (escopo
// 4.1) inclui, altera e exclui um pacote, e o afterAll apaga o exercício e os parâmetros do ano.
const ANO = 2031;
const CC_DEP = ccAnaliticoSob('4.1');
const CC_DAF = ccAnaliticoSob('4.3');
const CONTA = contaAnaliticaSob('4.1.1.5');
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu' });

async function confirmar(page: Page, botao: string): Promise<void> {
  await page.getByRole('button', { name: botao }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
}

test.describe.serial(`pacotes base zero ${ANO}`, () => {
  test.afterAll(async () => {
    // Deixa o banco do teste como estava (o Histórico é imutável e fica). Depende das tabelas por ano
    // da frente B que a criação do exercício preenche (garantirPremissasExercicio do cad):
    // parametros_exercicio, encargo_exercicio, conta_componente_exercicio, beneficio_mestre e
    // beneficio_cargo (copiada do ano-base). Se o cad passar a gravar outra tabela por ano, ela entra aqui.
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

  test('2. Gestor da DEP inclui um pacote mensal com prévia, altera para pontual e exclui; CC de outra diretoria não aparece', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gestor.login);
    await menu(page).getByRole('link', { name: 'Pacotes base zero' }).click();
    await expect(page).toHaveURL(/\/orc\/pacotes$/);
    await expect(page.getByRole('heading', { name: `Pacotes base zero (${ANO})` })).toBeVisible();
    const escolha = page.locator('#pacotes-cc');
    await expect(escolha.locator(`option[value="${CC_DEP}"]`)).toHaveCount(1);
    await expect(escolha.locator(`option[value="${CC_DAF}"]`)).toHaveCount(0);
    // CC fora do escopo pela URL: a tela volta para um CC do escopo.
    await page.goto(`/orc/pacotes?ano=${ANO}&cc=${CC_DAF}`);
    await expect(page.getByRole('heading', { name: `Pacotes do CC ${CC_DAF}` })).toHaveCount(0);

    await page.goto(`/orc/pacotes?ano=${ANO}&cc=${CC_DEP}`);
    await expect(page.getByRole('heading', { name: `Pacotes do CC ${CC_DEP}` })).toBeVisible();
    await expect(page.getByText('Nenhum pacote neste centro de custo.')).toBeVisible();
    await expect(page.locator('#novo-pacote-cc option')).not.toContainText([CC_DAF]);
    await page.getByLabel('Conta', { exact: true }).selectOption(CONTA.classificacao);
    await page.getByLabel('Atividade / justificativa (mín. 10 caracteres)').fill('Reposição anual de material de escritório da DEP');
    await page.getByLabel('Quantidade').fill('3');
    await page.getByLabel('Valor unitário (R$)').fill('1.234,57');
    await page.getByRole('radio', { name: 'Não' }).check();
    // Prévia: 3 × 1.234,57 = 3.703,71; 308,64 por mês e os centavos que sobram em dezembro.
    await expect(page.getByText('Valor anual: R$ 3.703,71')).toBeVisible();
    const parcelas = page.getByRole('table', { name: /^Parcelas mensais/ });
    await expect(parcelas.getByRole('cell')).toHaveText([...Array(11).fill('308,64'), '308,67']);
    await page.getByRole('button', { name: 'Incluir pacote' }).click();
    await expect(page).toHaveURL(new RegExp(`/orc/pacotes\\?ano=${ANO}&cc=${CC_DEP.replaceAll('.', '\\.')}&aviso=incluido&salvo=[0-9a-f-]{36}$`));
    await expect(page.getByText('Pacote incluído. O orçamento foi recalculado.')).toBeVisible();
    const linha = page.getByRole('row', { name: new RegExp(`^${CONTA.classificacao.replaceAll('.', '\\.')} `) });
    await expect(linha).toContainText('3.703,71');
    await expect(linha).toContainText('Mensal');
    await expect(linha).toContainText('Tela');

    await page.getByRole('link', { name: `Alterar pacote 1: ${CONTA.classificacao}, Reposição anual de material de escritóri…` }).click();
    await expect(page.getByRole('heading', { name: 'Alterar pacote' })).toBeVisible();
    await expect(linha).toHaveAttribute('aria-current', 'true');
    await page.getByRole('radio', { name: 'Pontual (um mês)' }).check();
    await page.getByLabel('Mês (se pontual)').selectOption({ label: 'Julho' });
    await expect(page.getByText('Todo o valor em Julho.')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar alteração' }).click();
    await expect(page.getByText('Pacote alterado. O orçamento foi recalculado.')).toBeVisible();
    await expect(linha).toContainText('Pontual (julho)');
    await expect(linha).toContainText('3.703,71');

    await confirmar(page, `Excluir pacote 1: ${CONTA.classificacao}, Reposição anual de material de escritóri…`);
    await expect(page.getByText('Pacote excluído. O orçamento foi recalculado.')).toBeVisible();
    await expect(page.getByText('Nenhum pacote neste centro de custo.')).toBeVisible();
  });
});
