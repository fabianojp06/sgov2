import { Competencia, Dinheiro, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { CELULA_INVALIDA, type TipoColuna, type ValorCelula } from '../domain/celula';
import { validarPlanilhas, type PlanilhaExportacao } from './exportacao';

// Contrato C3: exportação para XLSX (US-021, R21). Só pelo servidor.ts (R22): o index.ts do ger é
// importado por componentes cliente e não pode alcançar o ExcelJS, nem por import dinâmico.
//
// Injeção de fórmula (M2): todo texto de dado é gravado como valor de texto (cell.value = string),
// nunca como { formula } nem { hyperlink }, inclusive o que começa com = + - @ \t ou \r. Dinheiro vai
// como número com #,##0.00, convertido do texto decimal (nunca por cálculo em number).
export async function exportarXlsx(planilhas: readonly PlanilhaExportacao[]): Promise<Resultado<Uint8Array>> {
  const v = validarPlanilhas(planilhas);
  if (!v.ok) return falha(v.erros);


  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const p of planilhas) {
    const ws = wb.addWorksheet(p.nome);
    ws.columns = p.colunas.map((c) => ({
      header: c.titulo,
      // Largura em caracteres: cerca de 7 px por caractere.
      width: c.largura ? Math.max(4, Math.round(c.largura / 7)) : 18,
      ...(c.tipo === 'dinheiro' ? { style: { numFmt: '#,##0.00' } } : {}),
      ...(c.tipo === 'percentual' ? { style: { numFmt: '#,##0.00##' } } : {}),
      ...(c.tipo === 'data' ? { style: { numFmt: 'dd/mm/yyyy' } } : {}),
    }));
    ws.getRow(1).font = { bold: true };
    for (const linha of p.linhas) {
      const r = ws.addRow([]);
      linha.forEach((v, i) => {
        r.getCell(i + 1).value = valorDaCelula(p.colunas[i]!.tipo, v);
      });
    }
  }
  return ok(new Uint8Array(await wb.xlsx.writeBuffer()));
}

// Valor gravado na célula, sempre a partir do texto do contrato e pelo kernel. Fora do formato do
// tipo, o texto de célula inválida (como na tela); nunca uma exceção que derrube a exportação.
function valorDaCelula(tipo: TipoColuna, v: ValorCelula): string | number | Date | null {
  if (v === null) return null;
  try {
    switch (tipo) {
      case 'texto':
        return v;
      case 'dinheiro':
        return Number(Dinheiro.de(v).paraString());
      case 'percentual':
        return Number(Percentual.dePontos(v).paraString());
      case 'competencia':
        return Competencia.parse(v).formatar();
      case 'data': {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
        if (!m) return CELULA_INVALIDA;
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        return d.getUTCDate() === Number(m[3]) ? d : CELULA_INVALIDA;
      }
    }
  } catch {
    return CELULA_INVALIDA;
  }
}
