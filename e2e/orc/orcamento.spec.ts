import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { entrarNaTelaPrincipal, urlMigratorDoTeste, USUARIOS } from '../aut/apoio';
import { ccAnaliticoSob, ccsDaSubarvore, ccSintetico, contaAnaliticaSob, montarPlanilha, pacote, posicao, TOTAL_CCS_MINUTA } from './planilhas';

// Orçamento da Adm. Central de ponta a ponta (P6, Task 9; US-055, US-121, US-060, US-058, US-059 e
// US-061), com o C1 e o C2 reais: plano de contas oficial e minuta de CC da seed do cad, e o motor
// de custo de pessoal do cad. Os cenários 1 a 5 contam uma história só (o exercício 2027 nasce,
// recebe a planilha e as receitas, é visto pelo gestor e passa pela aprovação), então rodam em série.
const ANO = 2027;
const CC_DEP = ccAnaliticoSob('4.1'); // Diretoria de Estudos e Projetos: o escopo do gestor
const CC_DAF = ccAnaliticoSob('4.3'); // Diretoria Administrativa Financeira: fora do escopo dele
const CONTA = contaAnaliticaSob('4.1.1.5'); // despesas administrativas (fora das raízes de pessoal)
const JUSTIFICATIVA_REJEICAO = 'Revisar o quadro de pessoal da DEP antes de aprovar.';

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu' });
const conteudo = (page: Page) => page.locator('main.sgo-conteudo');
// Linha de tabela pelo cabeçalho de linha (o CC, a aba): o nome acessível começa por ele.
const linhaDe = (tabela: Locator, inicio: string) => tabela.getByRole('row', { name: new RegExp(`^${escapar(inicio)} `) });
// Valor (dd) do termo (dt) que começa com o texto dado: "Teto" não pega "% do teto".
const valorDo = (secao: Locator, termo: string) =>
  secao.locator('dt', { hasText: new RegExp(`^${escapar(termo)}`) }).locator('xpath=following-sibling::dd[1]');
const centavos = (texto: string) => {
  const m = /^(−\s)?R\$ ([\d.]+),(\d{2})/.exec(texto.trim());
  if (!m) throw new Error(`valor fora do formato: ${texto}`);
  return (m[1] ? -1n : 1n) * BigInt(m[2]!.replaceAll('.', '') + m[3]);
};
const emReais = (c: bigint) => {
  const abs = c < 0n ? -c : c;
  const inteira = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${c < 0n ? '− ' : ''}R$ ${inteira},${(abs % 100n).toString().padStart(2, '0')}`;
};

async function contarNoBanco(): Promise<{ posicoes: number; pacotes: number; importacoes: number }> {
  const cliente = new pg.Client({ connectionString: urlMigratorDoTeste() });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ posicoes: number; pacotes: number; importacoes: number }>(
      `SELECT (SELECT count(*)::int FROM orc_posicao) AS posicoes, (SELECT count(*)::int FROM orc_pacote) AS pacotes,
              (SELECT count(*)::int FROM orc_importacao) AS importacoes`,
    );
    return rows[0]!;
  } finally {
    await cliente.end();
  }
}

async function confirmar(page: Page, botao: string): Promise<void> {
  await page.getByRole('button', { name: botao }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sim' }).click();
}

async function incluirReceita(page: Page, tp: string, situacao: 'Confirmado' | 'Previsto', valorMes: string): Promise<void> {
  await page.getByRole('link', { name: 'Nova receita' }).click();
  await page.getByLabel('TP / versão').fill(tp);
  await page.getByLabel('Descrição').fill(`Rateio do ${tp}`);
  await page.getByRole('radio', { name: new RegExp(`^\\s*${situacao}`) }).check();
  for (const mes of ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']) {
    await page.getByLabel(mes, { exact: true }).fill(valorMes);
  }
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/orc\/receitas\?ano=2027&aviso=incluida$/);
  await expect(page.getByText('Receita incluída.')).toBeVisible();
}

test.describe.serial('orçamento da Adm. Central 2027', () => {
  test('1. GFIN cria o exercício 2027 em branco e avança para Em Elaboração', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gfin.login);
    await expect(menu(page).getByRole('heading', { name: 'Administração Central' })).toBeVisible();
    await menu(page).getByRole('link', { name: 'Exercícios' }).click();
    await expect(page).toHaveURL(/\/orc\/exercicios$/);
    await expect(page.getByText('Nenhum exercício cadastrado.')).toBeVisible();

    await page.getByRole('link', { name: 'Novo exercício' }).click();
    await page.getByRole('spinbutton', { name: 'Ano' }).fill(String(ANO));
    await page.getByLabel('Em branco').check();
    await page.getByRole('button', { name: 'Criar exercício' }).click();
    await expect(page).toHaveURL(/\/orc\/exercicios\?aviso=criado$/);
    await expect(page.getByText('Exercício criado.')).toBeVisible();
    const linha = page.getByRole('row', { name: new RegExp(`^${ANO}`) });
    await expect(linha).toContainText('Rascunho');

    await confirmar(page, `Avançar ${ANO} para Em Elaboração`);
    await expect(page).toHaveURL(/\/orc\/exercicios\?aviso=avancado$/);
    await expect(page.getByText('Exercício em elaboração.')).toBeVisible();
    await expect(linha).toContainText('Em Elaboração');
    await expect(page.getByRole('button', { name: /^Avançar/ })).toHaveCount(0);
  });

  test('2. GFIN importa a planilha com erro (relatório, nada gravado), corrige e vê o resumo por CC', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gfin.login);
    await menu(page).getByRole('link', { name: 'Importar planilha' }).click();
    await expect(page.getByRole('heading', { name: `Importar planilha (${ANO})` })).toBeVisible();
    const arquivo = page.getByLabel('Planilha (layout ADMC-ORC v1.0)');
    const validas = { pessoal: [posicao(CC_DEP), posicao(CC_DAF, { Cargo: 'Assistente financeiro', 'Salário mensal (R$)': 4200 })], pacotes: [pacote(CC_DEP, CONTA.classificacao)] };

    // Linha 6 da aba Pessoal num CC sintético (a diretoria, que não aceita lançamento).
    await arquivo.setInputFiles(await montarPlanilha({ ...validas, pessoal: [...validas.pessoal.slice(0, 1), posicao(ccSintetico('4.1'))] }));
    await page.getByRole('button', { name: 'Importar' }).click();
    const relatorio = conteudo(page).getByRole('alert');
    await expect(relatorio).toContainText('A planilha tem erros. Nada foi importado.');
    await expect(relatorio.getByRole('table', { name: 'Erros por linha (1)' })).toBeVisible();
    await expect(linhaDe(relatorio, 'Pessoal').getByRole('cell')).toHaveText(['6', 'CC analítico', 'CC não é analítico ativo.']);
    expect(await contarNoBanco()).toEqual({ posicoes: 0, pacotes: 0, importacoes: 0 });

    await arquivo.setInputFiles(await montarPlanilha(validas));
    await page.getByRole('button', { name: 'Importar' }).click();
    await expect(page.getByText('Planilha importada: 2 posições e 1 pacotes em 2 CCs, 0 receitas.')).toBeVisible();
    const resumo = page.getByRole('table', { name: 'Resumo por centro de custo' });
    const valor = /^[1-9][\d.]*,\d{2}$/;
    await expect(linhaDe(resumo, CC_DEP).getByRole('cell')).toHaveText(['1', '1', valor]);
    await expect(linhaDe(resumo, CC_DAF).getByRole('cell')).toHaveText(['1', '0', valor]);
    await expect(conteudo(page).getByRole('alert')).toHaveCount(0);
    expect(await contarNoBanco()).toEqual({ posicoes: 2, pacotes: 1, importacoes: 1 });
  });

  test('3. GFIN digita receitas confirmada e prevista; a visão mostra resultado e teto padrão (sem semáforo)', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gfin.login);
    await menu(page).getByRole('link', { name: 'Receitas – Rateio dos TPs' }).click();
    await incluirReceita(page, 'TP-2027/01', 'Confirmado', '100.000,00');
    await incluirReceita(page, 'TP-2027/02', 'Previsto', '5.000,00');
    await expect(page.getByText('Digitado na transição')).toHaveCount(2);

    await menu(page).getByRole('link', { name: 'Orçamento da Adm. Central' }).click();
    await expect(page.getByRole('heading', { name: `Orçamento da Adm. Central ${ANO}` })).toBeVisible();
    await expect(page.getByRole('treegrid')).toHaveAttribute('aria-rowcount', String(TOTAL_CCS_MINUTA + 1));
    const indicadores = page.locator('section[aria-labelledby="indicadores"]');
    await expect(valorDo(indicadores, 'Empregados em dezembro')).toHaveText('4');

    const painel = page.locator('section[aria-labelledby="painel-teto"]');
    await expect(painel.getByRole('heading', { name: 'Teto e resultado' })).toBeVisible();
    await expect(valorDo(painel, 'Receita confirmada')).toHaveText('R$ 1.200.000,00');
    await expect(valorDo(painel, 'Receita prevista')).toHaveText('R$ 60.000,00');
    await expect(valorDo(painel, 'Teto')).toHaveText('R$ 1.200.000,00 (padrão: rateio líquido confirmado)');
    // Resultado = rateio líquido confirmado − (pessoal + base zero); a prevista fica de fora.
    const orcado = centavos(await valorDo(painel, 'Despesas (orçado)').innerText());
    expect(orcado).toBeGreaterThan(0n);
    const resultado = 120_000_000n - orcado;
    await expect(valorDo(painel, 'Resultado do ano')).toHaveText(`${emReais(resultado)} ${resultado > 0n ? '(superávit)' : resultado < 0n ? '(déficit)' : '(equilíbrio)'}`);
    await expect(valorDo(painel, 'Saldo')).toHaveText(new RegExp(`^${escapar(emReais(resultado))}`));
    // O semáforo real (faixas por exercício do cad, Task 9a do P4, #234) ainda não está na main: o
    // painel aparece sem a faixa e com o aviso. Quando chegar, trocar por "Verde"/"Amarelo"/... .
    await expect(valorDo(painel, 'Semáforo')).toHaveText('—');
    await expect(page.getByText('As faixas do semáforo ainda não estão disponíveis.')).toBeVisible();
  });

  test('4. Gestor de Diretoria vê só a subárvore dele; outra diretoria e telas da Adm. Central inteira dão 404', async ({ page }) => {
    await entrarNaTelaPrincipal(page, USUARIOS.gestor.login);
    await expect(menu(page).getByRole('link', { name: 'Orçamento da Adm. Central' })).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Importar planilha' })).toHaveCount(0);
    await menu(page).getByRole('link', { name: 'Orçamento da Adm. Central' }).click();
    await expect(page.getByRole('heading', { name: 'Indicadores do escopo (4.1)' })).toBeVisible();
    const indicadores = page.locator('section[aria-labelledby="indicadores"]');
    await expect(valorDo(indicadores, 'Empregados em dezembro')).toHaveText('2'); // só a posição da DEP
    await expect(page.getByRole('heading', { name: 'Teto e resultado' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Recalcular' })).toHaveCount(0);
    const grade = page.getByRole('treegrid');
    await expect(grade).toHaveAttribute('aria-rowcount', String(ccsDaSubarvore('4.1').length + 1));
    await expect(grade.getByRole('link', { name: new RegExp(` ${escapar(CC_DEP)} `) })).toBeVisible();
    await expect(grade.getByRole('link', { name: / 4\.3/ })).toHaveCount(0);

    expect((await page.goto(`/orc/orcamento?ano=${ANO}&cc=${CC_DEP}`))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: new RegExp(`^Detalhe: .*${escapar(CC_DEP)}`) })).toBeVisible();
    expect((await page.goto(`/orc/orcamento?ano=${ANO}&cc=${CC_DAF}`))?.status()).toBe(404);
    for (const rota of ['/orc/receitas', '/orc/importacao', '/orc/aprovacao', '/orc/exercicios']) {
      expect((await page.goto(rota))?.status(), rota).toBe(404);
    }
  });

  test('5. GFIN envia; DIREX rejeita; GFIN reenvia; DIREX aprova e o exercício fica oficializado e fechado', async ({ browser }) => {
    const gfin = await (await browser.newContext()).newPage();
    const direx = await (await browser.newContext()).newPage();
    await entrarNaTelaPrincipal(gfin, USUARIOS.gfin.login);
    await entrarNaTelaPrincipal(direx, USUARIOS.direx.login);

    const enviar = async () => {
      await gfin.goto(`/orc/aprovacao?ano=${ANO}`);
      await confirmar(gfin, 'Enviar para aprovação');
      await expect(gfin.getByText('Orçamento enviado para aprovação.')).toBeVisible();
      await expect(gfin.getByText('Situação: Em Aprovação')).toBeVisible();
      await expect(gfin.getByRole('button', { name: 'Aprovar' })).toHaveCount(0); // a GFIN não aprova
    };
    await enviar();

    await menu(direx).getByRole('link', { name: 'Envio e aprovação' }).click();
    await expect(direx.getByRole('button', { name: 'Enviar para aprovação' })).toHaveCount(0);
    await direx.getByLabel('Justificativa da rejeição').fill(JUSTIFICATIVA_REJEICAO);
    await direx.getByRole('button', { name: 'Rejeitar' }).click();
    await expect(direx.getByText('Orçamento rejeitado; voltou para Em Elaboração.')).toBeVisible();
    await expect(direx.getByText('Situação: Em Elaboração')).toBeVisible();

    await enviar();

    await direx.goto(`/orc/aprovacao?ano=${ANO}`);
    await confirmar(direx, 'Aprovar');
    await expect(direx.getByText('Orçamento aprovado e oficializado.')).toBeVisible();
    await expect(direx.getByText(/^Oficializado em \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/)).toBeVisible();
    await expect(conteudo(direx).getByRole('button')).toHaveCount(0);
    // Histórico do ciclo, coluna "Para": avançar, enviar, rejeitar (com a justificativa), reenviar e oficializar.
    const tramites = direx.getByRole('table', { name: 'Trâmites do orçamento' });
    await expect(tramites.getByRole('rowheader')).toHaveText(['Em Elaboração', 'Em Aprovação', 'Em Elaboração', 'Em Aprovação', 'Oficializado']);
    await expect(tramites.getByRole('row').nth(3)).toContainText(`${USUARIOS.direx.nome}${JUSTIFICATIVA_REJEICAO}`);

    // Fechado: a visão fica somente leitura e a importação não é mais oferecida.
    await gfin.goto(`/orc/orcamento?ano=${ANO}`);
    await expect(gfin.getByText('Situação: Oficializado (somente leitura)')).toBeVisible();
    await expect(gfin.getByRole('button', { name: 'Recalcular' })).toHaveCount(0);
    await gfin.goto(`/orc/importacao?ano=${ANO}`);
    await expect(gfin.getByText('Este exercício não pode ser alterado na situação Oficializado.')).toBeVisible();
    await expect(gfin.getByLabel('Planilha (layout ADMC-ORC v1.0)')).toHaveCount(0);
    await gfin.goto(`/orc/aprovacao?ano=${ANO}`);
    await expect(conteudo(gfin).getByRole('button')).toHaveCount(0);
    await gfin.context().close();
    await direx.context().close();
  });
});

test('6. orçamentista não vê o menu Administração Central e recebe 404 em /orc/orcamento', async ({ page }) => {
  await entrarNaTelaPrincipal(page, USUARIOS.orcamentista.login);
  await expect(menu(page)).toBeVisible(); // tem as consultas do cad
  await expect(menu(page).getByRole('heading', { name: 'Administração Central' })).toHaveCount(0);
  expect((await page.goto('/orc/orcamento'))?.status()).toBe(404);
  expect((await page.goto('/orc/exercicios'))?.status()).toBe(404);
});
