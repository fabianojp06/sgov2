import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

// Planilha do orçamento da Adm. Central para o E2E (P6, Task 9), no layout ADMC-ORC v1.0 que a
// importação espera: abas Pessoal, Pacotes base zero e Receitas, título nas linhas 1 e 2, cabeçalho
// na linha 4 e dados a partir da linha 5. Os cabeçalhos ficam escritos aqui, e não importados do
// orc, para o E2E reprovar se o layout aceito mudar sem a planilha-modelo mudar junto.
// Os CCs e a conta vêm das listas do C1 real (minuta de CC e plano de contas oficial que a seed do
// cad carrega no banco do teste), não de valores inventados.

type Celula = string | number;
type Linha = Readonly<Record<string, Celula>>;
type LinhaC1 = { celulas: Record<string, string | null> };

const lerDados = (arquivo: string): LinhaC1[] => JSON.parse(readFileSync(`src/modules/cad/infrastructure/dados/${arquivo}`, 'utf8')) as LinhaC1[];

const CCS = lerDados('cc-minuta-rev23102026.json').map((l) => ({
  classificacao: l.celulas['Classificação']!,
  analitico: l.celulas['Tipo'] === 'Analítico',
}));
const CONTAS = lerDados('plano-contas-oficial.json').map((l) => ({
  classificacao: l.celulas['Classificação']!,
  descricao: l.celulas['Descrição']!,
  analitica: l.celulas['Tipo'] === 'A',
}));

/** Primeiro CC analítico da minuta dentro da subárvore `raiz`. */
export function ccAnaliticoSob(raiz: string): string {
  const cc = CCS.find((c) => c.analitico && c.classificacao.startsWith(`${raiz}.`));
  if (!cc) throw new Error(`a minuta de CC não tem CC analítico sob ${raiz}`);
  return cc.classificacao;
}

/** CC sintético da minuta (não aceita lançamento). */
export function ccSintetico(classificacao: string): string {
  if (!CCS.some((c) => c.classificacao === classificacao && !c.analitico)) throw new Error(`${classificacao} não é CC sintético da minuta`);
  return classificacao;
}

/** Classificações dos CCs da minuta na subárvore de `raiz`, incluindo ela. */
export const ccsDaSubarvore = (raiz: string): string[] =>
  CCS.filter((c) => c.classificacao === raiz || c.classificacao.startsWith(`${raiz}.`)).map((c) => c.classificacao);

export const TOTAL_CCS_MINUTA = CCS.length;

/** Primeira conta analítica do plano oficial dentro de `raiz` (fora das raízes de pessoal). */
export function contaAnaliticaSob(raiz: string): { classificacao: string; descricao: string } {
  const conta = CONTAS.find((c) => c.analitica && c.classificacao.startsWith(`${raiz}.`));
  if (!conta) throw new Error(`o plano de contas oficial não tem conta analítica sob ${raiz}`);
  return conta;
}

const COLUNAS = {
  Pessoal: ['CC analítico', 'Cargo', 'Quantidade', 'Salário mensal (R$)', 'Mês de início (1–12)', 'Mês de saída (1–12)', 'Observação'],
  'Pacotes base zero': [
    'CC analítico',
    'Conta analítica',
    'Atividade / justificativa (mín. 10 caracteres)',
    'Prioridade',
    'Quantidade',
    'Valor unitário (R$)',
    'Corrigir pelo IPCA?',
    'Distribuição',
    'Mês (se pontual)',
  ],
  Receitas: ['TP / versão', 'Descrição', 'Situação', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
} as const;

export const posicao = (cc: string, extra: Linha = {}): Linha => ({
  'CC analítico': cc,
  Cargo: 'Analista de orçamento',
  Quantidade: 2,
  'Salário mensal (R$)': 7500,
  'Mês de início (1–12)': 1,
  'Mês de saída (1–12)': 12,
  ...extra,
});

export const pacote = (cc: string, conta: string, extra: Linha = {}): Linha => ({
  'CC analítico': cc,
  'Conta analítica': conta,
  'Atividade / justificativa (mín. 10 caracteres)': 'Reposição anual de material de escritório',
  Prioridade: 'Importante',
  Quantidade: 12,
  'Valor unitário (R$)': 350,
  'Corrigir pelo IPCA?': 'Não',
  Distribuição: 'Mensal',
  ...extra,
});

function preencherAba(wb: ExcelJS.Workbook, nome: keyof typeof COLUNAS, linhas: readonly Linha[]): void {
  const ws = wb.addWorksheet(nome);
  ws.getCell('A1').value = `${nome} — orçamento da Adm. Central`;
  ws.getCell('A2').value = 'Preencha só as colunas amarelas.';
  COLUNAS[nome].forEach((coluna, i) => (ws.getCell(4, i + 1).value = coluna));
  linhas.forEach((linha, j) =>
    COLUNAS[nome].forEach((coluna, i) => {
      const valor = linha[coluna];
      if (valor !== undefined) ws.getCell(5 + j, i + 1).value = valor;
    }),
  );
}

/** .xlsx no layout ADMC-ORC v1.0, pronto para o setInputFiles do Playwright. */
export async function montarPlanilha(abas: { pessoal?: readonly Linha[]; pacotes?: readonly Linha[]; receitas?: readonly Linha[] }, nome = 'orcamento-2027.xlsx') {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Instruções').getCell('E1').value = 'ADMC-ORC v1.0';
  preencherAba(wb, 'Pessoal', abas.pessoal ?? []);
  preencherAba(wb, 'Pacotes base zero', abas.pacotes ?? []);
  preencherAba(wb, 'Receitas', abas.receitas ?? []);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { name: nome, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
}
