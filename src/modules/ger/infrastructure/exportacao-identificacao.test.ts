import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { criarIdentificacao, linhasIdentificacao, validarPlanilhas, type PlanilhaExportacao } from './exportacao';
import { exportarCsv } from './exportar-csv';
import { exportarXlsx } from './exportar-xlsx';

// US-024 (#46): cabeçalho com os filtros (RN0011) e a marca do operador e do rastreio (RN_WATERMARK)
// no XLSX e no CSV do C3.
const AGORA = new Date('2027-03-05T13:07:00Z'); // 10:07 em Brasília
const RASTREIO = '3f2b8c1e-0d4a-4b7e-9c55-1a2b3c4d5e6f';
const identificacao = criarIdentificacao(
  { titulo: 'Conferência da carga', filtros: [{ rotulo: 'Exercício', valor: '2027' }, { rotulo: 'Situação', valor: 'Ativas' }], operador: 'Maria GFIN' },
  AGORA,
  RASTREIO,
);
const base: PlanilhaExportacao = {
  nome: 'Dados',
  colunas: [
    { titulo: 'Conta', tipo: 'texto' },
    { titulo: 'Valor', tipo: 'dinheiro' },
  ],
  linhas: [
    ['4.1.1.1.001', '1234.50'],
    ['4.1.1.1.002', '10.00'],
  ],
};

async function ler(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb.worksheets[0]!;
}

describe('identificação da exportação (US-024)', () => {
  it('linhasIdentificacao: título, filtros, operador com a hora de Brasília e rastreio', () => {
    expect(linhasIdentificacao(identificacao)).toEqual([
      'Conferência da carga',
      'Filtros: Exercício: 2027; Situação: Ativas',
      'Exportado por Maria GFIN em 05/03/2027, 10:07 (horário de Brasília)',
      `Rastreio: ${RASTREIO}`,
    ]);
    expect(linhasIdentificacao({ ...identificacao, filtros: [] })[1]).toBe('Filtros: nenhum');
  });

  it('criarIdentificacao gera um rastreio novo a cada exportação', () => {
    const a = criarIdentificacao({ titulo: 't', filtros: [], operador: 'o' });
    const b = criarIdentificacao({ titulo: 't', filtros: [], operador: 'o' });
    expect(a.rastreio).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.rastreio).not.toBe(b.rastreio);
  });

  it('XLSX: o cabeçalho no topo, uma linha vazia, a tabela e o operador e o rastreio no rodapé', async () => {
    const r = await exportarXlsx([{ ...base, identificacao }]);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    const ws = await ler(r.valor);
    const coluna1 = Array.from({ length: ws.rowCount }, (_, i) => ws.getRow(i + 1).getCell(1).value);
    expect(coluna1).toEqual([...linhasIdentificacao(identificacao), null, 'Conta', '4.1.1.1.001', '4.1.1.1.002']);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.getRow(6).font?.bold).toBe(true);
    expect(ws.getRow(7).getCell(2).value).toBe(1234.5);
    expect(ws.headerFooter.oddFooter).toBe(`&LMaria GFIN&RRastreio ${RASTREIO}`);
  });

  it('XLSX: "&" no operador vira "&&" no rodapé (código do Excel)', async () => {
    const r = await exportarXlsx([{ ...base, identificacao: { ...identificacao, operador: 'Ana & Bia' } }]);
    if (!r.ok) throw new Error('falhou');
    expect((await ler(r.valor)).headerFooter.oddFooter).toBe(`&LAna && Bia&RRastreio ${RASTREIO}`);
  });

  it('XLSX: operador longo é cortado no rodapé (limite de 255 do Excel), sem partir um "&&"', async () => {
    for (const operador of ['x'.repeat(200), `${'x'.repeat(149)}&abc`, '&'.repeat(200)]) {
      const r = await exportarXlsx([{ ...base, identificacao: { ...identificacao, operador } }]);
      if (!r.ok) throw new Error('falhou');
      const rodape = (await ler(r.valor)).headerFooter.oddFooter!;
      expect(rodape.length).toBeLessThanOrEqual(255);
      const esquerda = /^&L(.*)&RRastreio /.exec(rodape)![1]!;
      expect(esquerda.length).toBeLessThanOrEqual(150);
      // Fora os "&&", nenhum "&" sozinho sobra no fim do trecho do operador.
      expect(esquerda.replace(/&&/g, '')).not.toContain('&');
    }
  });

  it('XLSX sem identificação: a tabela começa na linha 1, como antes', async () => {
    const r = await exportarXlsx([base]);
    if (!r.ok) throw new Error('falhou');
    const ws = await ler(r.valor);
    expect(ws.getRow(1).getCell(1).value).toBe('Conta');
    expect(ws.rowCount).toBe(3);
    expect(ws.headerFooter?.oddFooter).toBeUndefined();
  });

  it('CSV: o cabeçalho antes da tabela, com o escape de fórmula nas linhas do cabeçalho', () => {
    const r = exportarCsv({ ...base, identificacao: { ...identificacao, titulo: '=1+1', operador: '=HYPERLINK("x")', filtros: [{ rotulo: '+Filtro', valor: 'x' }] } });
    if (!r.ok) throw new Error('falhou');
    const linhas = new TextDecoder().decode(r.valor).replace(/^\uFEFF/, '').split('\r\n');
    expect(linhas.slice(0, 7)).toEqual([
      `"'=1+1"`,
      '"Filtros: +Filtro: x"',
      '"Exportado por =HYPERLINK(""x"") em 05/03/2027, 10:07 (horário de Brasília)"',
      `"Rastreio: ${RASTREIO}"`,
      '',
      '"Conta";"Valor"',
      '"4.1.1.1.001";"1234,50"',
    ]);
  });

  it('validação: título, operador, rastreio, data e filtros', () => {
    const erros = (i: Partial<typeof identificacao>) => {
      const v = validarPlanilhas([{ ...base, identificacao: { ...identificacao, ...i } }]);
      return v.ok ? [] : v.erros.map((e) => e.campo);
    };
    expect(erros({})).toEqual([]);
    expect(erros({ titulo: ' ' })).toEqual(['planilhas.0.identificacao.titulo']);
    expect(erros({ operador: '' })).toEqual(['planilhas.0.identificacao.operador']);
    expect(erros({ rastreio: 'x y' })).toEqual(['planilhas.0.identificacao.rastreio']);
    expect(erros({ geradoEm: 'ontem' })).toEqual(['planilhas.0.identificacao.geradoEm']);
    expect(erros({ filtros: Array.from({ length: 31 }, () => ({ rotulo: 'a', valor: 'b' })) })).toEqual(['planilhas.0.identificacao.filtros']);
    expect(erros({ filtros: [{ rotulo: '', valor: 'b' }] })).toEqual(['planilhas.0.identificacao.filtros']);
  });
});
