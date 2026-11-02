import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { PlanilhaExportacao } from './exportacao';
import { exportarXlsx } from './exportar-xlsx';

// Exportação XLSX real (plano do P4, Task 6b, R21 e M2): exportar e ler de volta.
async function ler(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

const INJECOES = ['=HYPERLINK("http://x","clique")', '+55 11 9999', '-100', '@soma', '\tx', '\rx', '=1+1'];

const planilhas: PlanilhaExportacao[] = [
  {
    nome: 'Orçamento',
    colunas: [
      { titulo: 'Conta', tipo: 'texto', largura: 210 },
      { titulo: 'Valor', tipo: 'dinheiro' },
      { titulo: '%', tipo: 'percentual' },
      { titulo: 'Competência', tipo: 'competencia' },
      { titulo: 'Data', tipo: 'data' },
    ],
    linhas: [
      ['4.1.1.1.001 Salários', '1234.50', '51', 'Jan/27', '2027-03-05'],
      ['Centavos', '0.10', '0.5', 'Dez/27', null],
      ['Inválido', 'abc', 'x', 'Xyz/99', '2027-02-30'],
    ],
  },
  { nome: 'Injeção', colunas: [{ titulo: 'Texto', tipo: 'texto' }], linhas: INJECOES.map((t) => [t]) },
];

describe('exportarXlsx (real)', () => {
  it('gera um .xlsx com as 2 abas, o cabeçalho e os tipos certos', async () => {
    const r = await exportarXlsx(planilhas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const wb = await ler(r.valor);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Orçamento', 'Injeção']);
    const ws = wb.getWorksheet('Orçamento')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Conta', 'Valor', '%', 'Competência', 'Data']);
    expect(ws.getCell('B2').value).toBe(1234.5);
    expect(ws.getCell('B2').numFmt).toBe('#,##0.00');
    expect(ws.getCell('B3').value).toBe(0.1);
    expect(ws.getCell('C2').value).toBe(51);
    expect(ws.getCell('D2').value).toBe('Jan/27');
    expect(typeof ws.getCell('D2').value).toBe('string');
    expect((ws.getCell('E2').value as Date).toISOString().slice(0, 10)).toBe('2027-03-05');
    expect(ws.getCell('E3').value).toBeNull();
    // Valor fora do formato do tipo vira o texto de célula inválida, sem derrubar a exportação.
    expect([ws.getCell('B4').value, ws.getCell('C4').value, ws.getCell('D4').value, ws.getCell('E4').value]).toEqual(['—', '—', '—', '—']);
    expect(ws.getColumn(1).width).toBe(30);
  });

  it('injeção de fórmula (M2): tudo sai como texto; nenhuma célula tem fórmula nem hyperlink', async () => {
    const r = await exportarXlsx(planilhas);
    if (!r.ok) throw new Error('falhou');
    const wb = await ler(r.valor);
    const ws = wb.getWorksheet('Injeção')!;
    INJECOES.forEach((t, i) => {
      const c = ws.getCell(i + 2, 1);
      // O XML normaliza o \r em \n na leitura; continua texto.
      expect(c.value).toBe(t.replace('\r', '\n'));
      expect(c.type).toBe(ExcelJS.ValueType.String);
    });
    for (const w of wb.worksheets) {
      w.eachRow((row) =>
        row.eachCell((c) => {
          expect(c.formula).toBeUndefined();
          expect(c.hyperlink).toBeUndefined();
          expect([ExcelJS.ValueType.Formula, ExcelJS.ValueType.Hyperlink]).not.toContain(c.type);
        }),
      );
    }
  });
});
