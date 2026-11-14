import ExcelJS from 'exceljs';
import { COLUNAS_PACOTES, COLUNAS_PESSOAL, COLUNAS_RECEITAS } from '../domain/planilha';

// Monta .xlsx no layout ADMC-ORC v1.0 para os testes (Task 4b): cabeçalho na linha 4, dados a
// partir da linha 5. Como a planilha-modelo, pode ter colunas cinzas com fórmula sem valor em cache
// e linhas só com fórmula (o modelo é gravado com fullCalcOnLoad).

type Linha = Record<string, string | number | null>;
export type OpcoesPlanilha = {
  pessoal?: readonly Linha[];
  pacotes?: readonly Linha[];
  receitas?: readonly Linha[];
  formulasSemValor?: boolean; // coluna cinza com fórmula sem resultado + 300 linhas só com fórmula
  semColuna?: { aba: 'Pessoal' | 'Pacotes base zero' | 'Receitas'; coluna: string };
  versaoLayout?: string | null; // Instruções!E1; null: sem a aba Instruções
};

function aba(wb: ExcelJS.Workbook, nome: string, colunas: readonly string[], linhas: readonly Linha[], o: OpcoesPlanilha) {
  const ws = wb.addWorksheet(nome);
  // Como o modelo: título, subtítulo, a linha 3 com "mês →" e números, e uma coluna cinza logo
  // depois da primeira (a descrição do CC) com fórmula sem valor em cache.
  ws.getCell('A1').value = `${nome} — orçamento`;
  ws.getCell('A2').value = 'Preencha só as colunas amarelas.';
  const cabecalho = colunas.filter((c) => !(o.semColuna?.aba === nome && o.semColuna.coluna === c));
  const todas = o.formulasSemValor ? [cabecalho[0]!, 'Descrição (cinza)', ...cabecalho.slice(1)] : cabecalho;
  ws.getCell(3, 2).value = 'mês →';
  for (let k = 0; k < 3; k++) ws.getCell(3, 3 + k).value = k + 1;
  todas.forEach((c, i) => (ws.getCell(4, i + 1).value = c));
  linhas.forEach((l, j) => {
    todas.forEach((c, i) => {
      const v = l[c];
      if (v !== undefined && v !== null) ws.getCell(5 + j, i + 1).value = v;
    });
  });
  if (o.formulasSemValor) {
    for (let r = 5; r < 5 + 300; r++) ws.getCell(r, 2).value = { formula: `IF(A${r}="","",A${r})` } as ExcelJS.CellFormulaValue;
  }
}

export async function montarPlanilha(o: OpcoesPlanilha & { nome?: string } = {}): Promise<{ nome: string; conteudo: Uint8Array }> {
  const wb = new ExcelJS.Workbook();
  if (o.versaoLayout !== null) wb.addWorksheet('Instruções').getCell('E1').value = o.versaoLayout ?? 'ADMC-ORC v1.0';
  aba(wb, 'Pessoal', COLUNAS_PESSOAL, o.pessoal ?? [], o);
  aba(wb, 'Pacotes base zero', COLUNAS_PACOTES, o.pacotes ?? [], o);
  aba(wb, 'Receitas', COLUNAS_RECEITAS, o.receitas ?? [], o);
  const buffer = await wb.xlsx.writeBuffer();
  return { nome: o.nome ?? 'orcamento-2027.xlsx', conteudo: new Uint8Array(buffer as ArrayBuffer) };
}

export const linhaPessoal = (cc: string, extra: Linha = {}): Linha => ({
  'CC analítico': cc,
  Cargo: 'Analista de orçamento',
  Quantidade: 2,
  'Salário mensal (R$)': 7500,
  'Mês de início (1–12)': 1,
  'Mês de saída (1–12)': 12,
  ...extra,
});
export const linhaPacote = (cc: string, extra: Linha = {}): Linha => ({
  'CC analítico': cc,
  'Conta analítica': '4.1.1.5.005',
  'Atividade / justificativa (mín. 10 caracteres)': 'Reposição anual de material de escritório',
  Prioridade: 'Importante',
  Quantidade: 12,
  'Valor unitário (R$)': 350,
  'Corrigir pelo IPCA?': 'Sim',
  Distribuição: 'Mensal',
  ...extra,
});
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const linhaReceita = (tp: string, extra: Linha = {}): Linha => ({
  'TP / versão': tp,
  Descrição: 'Contrato de apoio técnico',
  Situação: 'Confirmado',
  ...Object.fromEntries(MESES.map((m) => [m, 1000])),
  ...extra,
});

/** Arquivo do realizado no layout PROVISÓRIO (US-085, D-P32-1): aba Realizado, cabeçalho na linha 1. */
export async function montarArquivoRealizado(linhas: readonly (readonly (string | number | null)[])[], nome = 'realizado.xlsx'): Promise<{ nome: string; conteudo: Uint8Array }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Realizado');
  ws.addRow(['Conta', 'Competência', 'Valor']);
  for (const l of linhas) ws.addRow([...l]);
  const buffer = await wb.xlsx.writeBuffer();
  return { nome, conteudo: new Uint8Array(buffer as ArrayBuffer) };
}
