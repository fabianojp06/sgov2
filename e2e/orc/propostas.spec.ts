import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Proposta de TP pela tela (US-065; plano do P17, Task 2, Step 3), com nova versão e duplicar (US-066; plano
// do P18, Task 2, Step 3), as metas (US-067; plano do P19, Task 2, Step 3), o pessoal (US-070; plano do P20,
// Task 2, Step 3), as viagens (US-071; plano do P21, Task 2, Step 3) e os bens (US-072; plano do P22, Task 2, Step 3).
//
// Usa a estrutura sintética de CCs de TP da seed de referência da frente B (raiz 9, analíticos 9.1 a 9.3,
// #438).
//
// Roteiro: o Orçamentista cria a proposta com o CC 9.1; ela aparece na lista em Rascunho, com o valor
// global 0,00; o seletor de unidade da tela principal passa a mostrar o TP (o criador é vinculado na
// criação, D-P17-3); o Orçamentista cria a Versão 2 e duplica a proposta para o TP-E2E-002, com o CC 9.2;
// a cópia passa à categoria Meta, e o Orçamentista inclui, altera e exclui metas nela, com a nova versão
// copiando as metas; na versão nova, uma vaga "A CONTRATAR" e um quantitativo que a conta; os tetos de passagens
// e de diárias, uma viagem e a cópia dela recusada pelo teto; um bem na conta de máquinas e equipamentos; a proposta é excluída pela confirmação do UC 3.07; e o CC 9.1 volta ao seletor de CC
// livre (D-P17-10). O afterAll apaga os bens, as viagens, o pessoal, as metas, as capas, as versões, os vínculos e as unidades dos dois TPs
// (o Histórico fica).
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
      await cliente.query(`DELETE FROM orc_bem WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM orc_viagem WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM orc_teto_viagem WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM orc_qtde_empregado WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM orc_empregado WHERE unidade_id IN ${unidade}`);
      await cliente.query(`DELETE FROM orc_meta WHERE unidade_id IN ${unidade}`);
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
    // A cópia opera por metas (passo 3b).
    await page.getByLabel('Categoria').selectOption('META');
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

  test('3b. o Orçamentista inclui, altera e exclui metas na cópia; a nova versão copia as metas', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto('/orc/propostas');
    await page.getByRole('link', { name: `Metas da proposta ${NUMERO_COPIA}` }).click();
    await expect(page).toHaveURL(/\/orc\/metas\?proposta=/);
    const bloco = page.getByRole('region', { name: `${NUMERO_COPIA} – Cópia de ${OBJETO}` });
    await page.getByRole('link', { name: `Nova meta na proposta ${NUMERO_COPIA}` }).click();
    await expect(page.locator('#nova-meta-proposta')).toHaveValue(`${NUMERO_COPIA} – Cópia de ${OBJETO}`);
    await page.getByLabel('Número da meta').fill('M1');
    await page.getByLabel('Nome da meta').fill('Oficinas de capacitação');
    await page.getByLabel('Valor global (R$)').fill('1.234,56');
    await page.getByRole('button', { name: 'Incluir meta' }).click();
    await expect(page).toHaveURL(/\/orc\/metas\?aviso=incluida&m=M1/);
    await expect(page.getByText('Meta M1 incluída.')).toBeVisible();
    await expect(bloco.getByRole('row', { name: /^M1 / })).toContainText('Oficinas de capacitação');
    await expect(bloco.getByText('Total das metas ativas (R$)').locator('xpath=following-sibling::dd[1]')).toHaveText('1.234,56');

    await bloco.getByRole('link', { name: 'Editar a meta M1' }).click();
    await expect(page.getByLabel('Número da meta')).toHaveValue('M1');
    await page.getByLabel('Nome da meta').fill('Oficinas regionais');
    await page.getByRole('button', { name: 'Salvar meta' }).click();
    await expect(page.getByText('Meta M1 alterada.')).toBeVisible();
    await expect(bloco.getByRole('row', { name: /^M1 / })).toContainText('Oficinas regionais');

    // A nova versão leva a meta (RN_DUP_003), e a exclusão age na versão nova.
    await page.goto('/orc/propostas');
    await page.getByRole('button', { name: `Nova versão da proposta ${NUMERO_COPIA}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
    await expect(page.getByText(`Nova versão da proposta do TP ${NUMERO_COPIA} criada em Rascunho.`)).toBeVisible();
    await page.goto('/orc/metas');
    await expect(bloco).toContainText('Versão 2');
    await expect(bloco.getByRole('row', { name: /^M1 / })).toContainText('Oficinas regionais');
    await bloco.getByRole('button', { name: 'Excluir a meta M1' }).click();
    const caixa = page.getByRole('alertdialog');
    await expect(caixa).toContainText('Deseja realmente excluir esta meta? Esta ação não poderá ser desfeita.');
    await caixa.getByRole('button', { name: 'Sim' }).click();
    await expect(page.getByText('Meta M1 excluída.')).toBeVisible();
    await expect(bloco.getByRole('row', { name: /^M1 / })).toHaveCount(0);
  });

  test('3c. na versão nova, uma vaga "A CONTRATAR" na meta e um quantitativo que a conta', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto(`/orc/metas?proposta=${NUMERO_COPIA}`);
    await page.getByRole('link', { name: `Nova meta na proposta ${NUMERO_COPIA}` }).click();
    await page.getByLabel('Número da meta').fill('M2');
    await page.getByLabel('Nome da meta').fill('Atendimento');
    await page.getByLabel('Valor global (R$)').fill('0');
    await page.getByRole('button', { name: 'Incluir meta' }).click();
    await expect(page.getByText('Meta M2 incluída.')).toBeVisible();

    await page.goto('/orc/propostas');
    await page.getByRole('link', { name: `Empregados da proposta ${NUMERO_COPIA}` }).click();
    await expect(page).toHaveURL(/\/orc\/empregados\?proposta=/);
    await page.getByRole('link', { name: `Novo empregado na proposta ${NUMERO_COPIA}` }).click();
    await page.locator('#novo-empregado-meta').selectOption({ label: 'M2 – Atendimento' });
    const cargo = await page.locator('#novo-empregado-cargo option', { hasText: 'SINT-001' }).getAttribute('value');
    await page.locator('#novo-empregado-cargo').selectOption(cargo!);
    await page.locator('#novo-empregado-inicio').fill('2027-03');
    await page.getByRole('button', { name: 'Incluir empregado' }).click();
    await expect(page.getByText('Empregado 1 (A CONTRATAR) incluído.')).toBeVisible();
    const grupo = page.getByRole('region', { name: /^Meta M2 – Atendimento/ });
    await expect(grupo.getByRole('row', { name: /^1 / })).toContainText('A CONTRATAR');
    await expect(grupo.getByRole('row', { name: /^1 / })).toContainText('03/2027 a 12/2027');
    await expect(grupo).toContainText('Total da meta M2: Empregados 1 · Estagiários 0 · Jovens Aprendizes 0');

    await page.goto(`/orc/qtde-empregados?proposta=${NUMERO_COPIA}`);
    await page.getByRole('link', { name: `Novo quantitativo na proposta ${NUMERO_COPIA}` }).click();
    await page.locator('#nova-qtde-meta').selectOption({ label: 'M2 – Atendimento' });
    await page.getByLabel('Número do documento').fill('AP-E2E');
    await page.getByRole('button', { name: 'Incluir quantitativo' }).click();
    await expect(page.getByText('Quantitativo do documento AP-E2E incluído.')).toBeVisible();
    await expect(page.getByRole('row', { name: /^AP-E2E / })).toHaveText(/AP-E2E\s*01\/2027\s*12\/2027\s*1\s*0\s*0/);
  });

  test('3d. os tetos de passagens e de diárias, uma viagem no painel e a cópia recusada pelo teto', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto('/orc/propostas');
    await page.getByRole('link', { name: `Viagens da proposta ${NUMERO_COPIA}` }).click();
    await expect(page).toHaveURL(/\/orc\/viagens\?proposta=/);
    // O plano oficial separa DESPESA DE VIAGEM (4.1.1.3) e DESPESA DE DIÁRIA (4.1.1.4): um teto para cada.
    for (const [conta, valor] of [
      ['4.1.1.3', '5.000,00'],
      ['4.1.1.4', '2.000,00'],
    ] as const) {
      await page.getByRole('link', { name: `Novo teto de viagens na proposta ${NUMERO_COPIA}` }).click();
      await page.locator('#novo-teto-conta').selectOption(conta);
      await page.getByLabel('Teto da conta (R$)').fill(valor);
      await page.getByRole('button', { name: 'Incluir teto' }).click();
      await expect(page.getByText(`Teto da conta ${conta} incluído.`)).toBeVisible();
    }

    await page.getByRole('link', { name: `Nova viagem na proposta ${NUMERO_COPIA}` }).click();
    await page.locator('#incluir-viagem-meta').selectOption({ label: 'M2 – Atendimento' });
    await page.getByLabel('Localidade (país)').fill('Brasil');
    await page.getByLabel('Quantidade de pessoas').fill('2');
    await page.getByLabel('Média de dias').fill('3');
    await page.getByLabel('Custo unitário de passagem, ida e volta (R$)').fill('1.000,00');
    await page.getByLabel('Custo de diária por pessoa (R$)').fill('250,00');
    await page.locator('#incluir-viagem-contaPassagem').selectOption('4.1.1.3.001');
    await page.locator('#incluir-viagem-contaDiaria').selectOption('4.1.1.4.007');
    await page.getByRole('button', { name: 'Incluir viagem' }).click();
    await expect(page.getByText('Viagem para Brasil incluída.')).toBeVisible();
    const grupo = page.getByRole('region', { name: /^Meta M2 – Atendimento/ });
    await expect(grupo.getByRole('row', { name: /^Brasil / })).toHaveText(/Brasil\s*2\s*3\s*1\.000,00\s*250,00\s*0,00\s*3\.500,00/);
    await expect(page.getByRole('row', { name: /^4\.1\.1\.4 / })).toHaveText(/2\.000,00\s*1\.500,00\s*500,00/);
    await expect(page.getByRole('region', { name: `Painel das viagens da proposta ${NUMERO_COPIA}` })).toContainText(/Custo total estimado\s*R\$\s*3\.500,00/);

    // Copiar com 3 pessoas: as diárias somariam 3.750,00 contra o teto de 2.000,00 (E3).
    await grupo.getByRole('link', { name: 'Copiar a viagem para Brasil' }).click();
    await expect(page.getByLabel('Localidade (país)')).toHaveValue('Brasil');
    await page.getByLabel('Quantidade de pessoas').fill('3');
    await page.getByRole('button', { name: 'Incluir viagem' }).click();
    await expect(page.getByText('Operação Rejeitada: O somatório das viagens operacionais excede o teto orçamentário disponível na Conta Sintética selecionada (4.1.1.4).')).toBeVisible();
  });

  test('3e. um bem na conta de máquinas e equipamentos, com o subtotal e o total geral', async ({ page }) => {
    await entrarNaTelaPrincipal(page, usuario.login);
    await page.goto('/orc/propostas');
    await page.getByRole('link', { name: `Bens da proposta ${NUMERO_COPIA}` }).click();
    await expect(page).toHaveURL(/\/orc\/bens\?proposta=/);
    await page.getByRole('link', { name: `Novo bem, serviço ou equipamento na proposta ${NUMERO_COPIA}` }).click();
    await page.locator('#novo-bem-meta').selectOption({ label: 'M2 – Atendimento' });
    await page.locator('#novo-bem-conta').selectOption('4.1.1.7.003');
    await page.getByLabel('Descrição').fill('Notebook E2E');
    await page.getByLabel('Data', { exact: true }).fill('2027-05-10');
    await page.getByLabel('Quantidade').fill('3');
    await page.getByLabel('Valor unitário (R$)').fill('1.234,56');
    await page.getByRole('button', { name: 'Incluir item' }).click();
    await expect(page.getByText('Item "Notebook E2E" incluído.')).toBeVisible();
    const grupo = page.getByRole('region', { name: /^Conta 4\.1\.1\.7\.003 / });
    await expect(grupo.getByRole('row', { name: /^10\/05\/2027 / })).toHaveText(/Notebook E2E\s*M2 – Atendimento\s*3\s*1\.234,56\s*3\.703,68/);
    await expect(grupo).toContainText('Subtotal da conta 4.1.1.7.003');
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
