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

const INJECOES = [
  '=HYPERLINK("http://x","clique")',
  '+55 11 9999',
  '-100',
  '@soma',
  '\tx',
  '\rx',
  '=1+1',
  "=cmd|' /C calc'!A0",
  '\uFF1D1+1',
  'https://exemplo.org',
];

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

  it('títulos e nome de aba com injeção saem como texto; dinheiro no limite do NUMERIC(15,2) relido exato', async () => {
    const r = await exportarXlsx([
      {
        nome: '=Aba',
        colunas: [
          { titulo: '=SOMA(A1)', tipo: 'texto' },
          { titulo: 'Valor', tipo: 'dinheiro' },
        ],
        linhas: [
          ['a', '9999999999999.99'],
          ['b', '-9999999999999.99'],
          ['c', '1234567890123.45'],
        ],
      },
    ]);
    if (!r.ok) throw new Error('falhou');
    const ws = (await ler(r.valor)).getWorksheet('=Aba')!;
    expect(ws.getCell('A1').value).toBe('=SOMA(A1)');
    expect(ws.getCell('A1').formula).toBeUndefined();
    expect([ws.getCell('B2').value, ws.getCell('B3').value, ws.getCell('B4').value]).toEqual([9999999999999.99, -9999999999999.99, 1234567890123.45]);
  });

  it('caractere fora do XML (U+FFFE) sai do texto e o arquivo continua válido; célula acima de 32.767 é cortada', async () => {
    const r = await exportarXlsx([
      { nome: 'A', colunas: [{ titulo: 'T\uFFFE', tipo: 'texto' }], linhas: [['a\uFFFEb\uFFFF'], ['x'.repeat(40_000)]] },
    ]);
    if (!r.ok) throw new Error('falhou');
    const ws = (await ler(r.valor)).getWorksheet('A')!;
    expect([ws.getCell('A1').value, ws.getCell('A2').value]).toEqual(['T', 'ab']);
    expect((ws.getCell('A3').value as string).length).toBe(32_767);
  });

  it('nome de aba com caractere fora do XML ou "History" é recusado como erro (sem rejeitar a promessa)', async () => {
    for (const nome of ['A\uFFFE', 'history', 'HISTORY']) {
      const r = await exportarXlsx([{ nome, colunas: [{ titulo: 'T', tipo: 'texto' }], linhas: [] }]);
      expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'planilhas.0.nome' })] });
    }
  });

  it('datas fora do calendário (mês 13, mês 0, lixo depois) saem como "—", igual à tela', async () => {
    const r = await exportarXlsx([
      { nome: 'D', colunas: [{ titulo: 'Data', tipo: 'data' }], linhas: [['2027-13-01'], ['2027-00-10'], ['2027-03-05lixo'], ['2027-03-05T10:00:00Z']] },
    ]);
    if (!r.ok) throw new Error('falhou');
    const ws = (await ler(r.valor)).getWorksheet('D')!;
    expect([ws.getCell('A2').value, ws.getCell('A3').value, ws.getCell('A4').value]).toEqual(['—', '—', '—']);
    expect((ws.getCell('A5').value as Date).toISOString().slice(0, 10)).toBe('2027-03-05');
  });

  it('percentual em pontos, com o símbolo literal no formato', async () => {
    const r = await exportarXlsx(planilhas);
    if (!r.ok) throw new Error('falhou');
    expect((await ler(r.valor)).getWorksheet('Orçamento')!.getCell('C2').numFmt).toBe('#,##0.00##"%"');
  });
});
