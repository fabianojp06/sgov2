import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';

// Módulos e funcionalidades (US-035; EP085 UC02.05 e UC02.06). O Administrador desativa o módulo
// da Adm. Central (o do orc): o GFIN conectado cai (D-P9-8) e, ao voltar, não vê o módulo. Ativar o
// módulo não reativa as funcionalidades (RN0033); só a funcionalidade ativada volta ao menu.
const MODULO = 'Administração Central';

// Outros specs (ex.: e2e/seguranca/autorizacao.spec.ts, e2e/orc) dependem do catálogo da seed: no
// fim, tudo volta a ficar ativo, mesmo se o cenário falhar no meio.
async function reativarAdmCentral(): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await cliente.connect();
  try {
    await cliente.query(`UPDATE modulo SET ativo = true WHERE codigo = 'ADM_CENTRAL'`);
    await cliente.query(`UPDATE funcionalidade SET ativo = true WHERE modulo_codigo = 'ADM_CENTRAL'`);
  } finally {
    await cliente.end();
  }
}

const funcionalidades = (page: Page) => page.getByRole('table', { name: `Funcionalidades do módulo ${MODULO}` });
const linhaModulo = (page: Page, nome: string) => page.getByRole('table', { name: 'Módulos' }).getByRole('row').filter({ has: page.getByRole('link', { name: nome, exact: true }) });

async function confirmar(page: Page, botao: ReturnType<Page['getByRole']>, pergunta: string): Promise<void> {
  await botao.click();
  const caixa = page.getByRole('alertdialog');
  await expect(caixa).toContainText(pergunta);
  await caixa.getByRole('button', { name: 'Sim' }).click();
}

test('orçamentista em /adm/modulos recebe 404', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  expect((await page.goto('/adm/modulos'))?.status()).toBe(404);
});

test('administrador: a Administração não tem Desativar (D-P9-7)', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.modulos.login);
  await page.getByRole('navigation').getByRole('link', { name: 'Módulos e Funcionalidades' }).click();
  await expect(page).toHaveURL(/\/adm\/modulos$/);
  await page.getByRole('table', { name: 'Módulos' }).getByRole('link', { name: 'Administração', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Módulo Administração' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Funcionalidades do módulo Administração' }).getByRole('row', { name: /Usuários/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desativar' })).toHaveCount(0);
});

test('desativar a Adm. Central derruba o GFIN e tira o módulo do menu; reativar não volta as funcionalidades', async ({ browser }) => {
  const estacaoAdmin = await browser.newContext();
  const estacaoGfin = await browser.newContext();
  try {
    const gfin = await estacaoGfin.newPage();
    await entrarNaTelaPrincipal(gfin, USUARIOS.gfinModulos.login);
    const menuGfin = gfin.getByRole('navigation');
    await expect(menuGfin.getByRole('heading', { name: MODULO, exact: true })).toBeVisible();

    const adm = await estacaoAdmin.newPage();
    await entrarNaTelaPrincipal(adm, USUARIOS.modulos.login);
    await adm.goto('/adm/modulos');
    await linhaModulo(adm, MODULO).getByRole('link').click();
    await expect(funcionalidades(adm).getByRole('row', { name: /Exercícios/ })).toContainText('Ativa');

    // UC02.05 A1: desativa o módulo e as funcionalidades dele (RN0034).
    await confirmar(adm, adm.getByRole('button', { name: 'Desativar' }).first(), 'Deseja realmente desativar o módulo?');
    await expect(adm).toHaveURL(/\/adm\/modulos\?modulo=ADM_CENTRAL&aviso=modulo-desativado$/);
    await expect(adm.getByRole('status').filter({ hasText: 'Módulo desativado com sucesso.' })).toBeVisible();
    await expect(linhaModulo(adm, MODULO)).toContainText('Inativo');
    await expect(funcionalidades(adm)).toHaveCount(0);

    // O GFIN cai na próxima requisição (D-P9-8) e, ao voltar, não vê o módulo.
    await gfin.goto('/inicio');
    await expect(gfin).toHaveURL(/\/login/);
    await entrarNaTelaPrincipal(gfin, USUARIOS.gfinModulos.login);
    await expect(gfin.getByRole('heading', { name: MODULO, exact: true })).toHaveCount(0);
    expect((await gfin.goto('/orc/exercicios'))?.status()).toBe(404);

    // UC02.05: ativar o módulo não ativa as funcionalidades (RN0033) nem derruba ninguém (RN0041).
    await confirmar(adm, adm.getByRole('button', { name: 'Ativar' }), 'Deseja realmente ativar o módulo?');
    await expect(adm).toHaveURL(/aviso=modulo-ativado$/);
    await expect(linhaModulo(adm, MODULO)).toContainText('Ativo');
    // Nenhuma funcionalidade volta ativa, qualquer que seja o número delas na seed.
    await expect(funcionalidades(adm).getByRole('cell', { name: 'Inativa', exact: true }).first()).toBeVisible();
    await expect(funcionalidades(adm).getByRole('cell', { name: 'Ativa', exact: true })).toHaveCount(0);
    await gfin.goto('/inicio');
    await expect(gfin).toHaveURL(/\/inicio$/);
    await expect(gfin.getByRole('heading', { name: MODULO, exact: true })).toHaveCount(0);

    // UC02.06: ativa só Exercícios; ele volta ao menu do GFIN, sem desconectar.
    const exercicios = funcionalidades(adm).getByRole('row', { name: /Exercícios/ });
    await confirmar(adm, exercicios.getByRole('button', { name: 'Ativar' }), 'Deseja realmente ativar esta funcionalidade?');
    await expect(adm).toHaveURL(/aviso=funcionalidade-ativada$/);
    await expect(funcionalidades(adm).getByRole('row', { name: /Exercícios/ })).toContainText('Ativa');
    await gfin.goto('/inicio');
    await expect(gfin).toHaveURL(/\/inicio$/);
    await expect(gfin.getByRole('navigation').getByRole('link', { name: 'Exercícios' })).toBeVisible();
    await expect(gfin.getByRole('navigation').getByRole('link', { name: 'Orçamento da Adm. Central' })).toHaveCount(0);

    // UC02.06 A1: desativar a funcionalidade pede a confirmação do UC e derruba o GFIN de novo.
    await confirmar(adm, funcionalidades(adm).getByRole('row', { name: /Exercícios/ }).getByRole('button', { name: 'Desativar' }), 'Deseja realmente desativar a funcionalidade?');
    await expect(adm).toHaveURL(/aviso=funcionalidade-desativada$/);
    await gfin.goto('/inicio');
    await expect(gfin).toHaveURL(/\/login/);
  } finally {
    await Promise.all([estacaoAdmin.close(), estacaoGfin.close()]);
    await reativarAdmCentral();
  }
});
