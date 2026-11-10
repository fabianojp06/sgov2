// Grava o plano de contas sintético (o oficial mais o ramo "9") num .xlsx no layout da carga, para
// importar pela tela do plano de contas (plano do P7, Task 3, Step 1, D-P7-3). Só gera o arquivo:
// não toca banco nenhum. Uso: npx tsx ops/carga/gerar-plano.ts <saida.xlsx> [linhas=5000]
import ExcelJS from 'exceljs';
import { COLUNAS_PLANO_CONTAS, gerarPlanoSintetico } from '@/modules/cad/servidor';

const [saida, linhasTexto = '5000'] = process.argv.slice(2);
if (!saida || !saida.endsWith('.xlsx')) {
  console.error('Uso: npx tsx ops/carga/gerar-plano.ts <saida.xlsx> [linhas=5000]');
  process.exit(2);
}

const linhas = gerarPlanoSintetico(Number(linhasTexto));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Plano de Contas');
ws.addRow([...COLUNAS_PLANO_CONTAS]);
for (const l of linhas) ws.addRow(COLUNAS_PLANO_CONTAS.map((c) => l.celulas[c] ?? null));
await wb.xlsx.writeFile(saida);
console.log(`${saida}: ${linhas.length} contas (${linhas.filter((l) => l.celulas['Tipo'] === 'A').length} analíticas)`);
