import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { lerPlanilhaSegura, LIMITES_PADRAO, sanearNomeArquivo } from './ler-xlsx';
import { empacotarSemCompressao, lerZipSeguro } from './zip-seguro';

// Leitor seguro de .xlsx (plano do P4, Task 4a, Step 1). As planilhas são montadas com ExcelJS.
const COLUNAS = ['Classificação', 'Descrição', 'Conta Reduzida'];

async function planilha(linhas: unknown[][], opcoes: { aba?: string; outraAbaAntes?: boolean } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  if (opcoes.outraAbaAntes) wb.addWorksheet('Resumo').addRow(['nada aqui']);
  const ws = wb.addWorksheet(opcoes.aba ?? 'Plano de Contas');
  for (const l of linhas) ws.addRow(l);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const ler = (conteudo: Uint8Array, extra: Partial<Parameters<typeof lerPlanilhaSegura>[1]> = {}) =>
  lerPlanilhaSegura({ nome: 'plano.xlsx', conteudo }, { colunas: COLUNAS, linhaCabecalhoMax: 10, ...extra });

describe('lerPlanilhaSegura — conteúdo', () => {
  it('lê pelo nome da coluna, fora de ordem e com caixa e acento diferentes', async () => {
    const x = await planilha([
      ['conta reduzida', 'DESCRICAO', 'Ignorada', 'classificacao'],
      [900, 'Salários', 'x', '4.1.1.1.001'],
      [null, 'DESPESAS', 'y', '4'],
    ]);
    const r = await ler(x);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.nomeArquivo).toBe('plano.xlsx');
    expect(r.valor.errosCelula).toEqual([]);
    expect(r.valor.linhas).toEqual([
      { numero: 2, celulas: { Classificação: '4.1.1.1.001', Descrição: 'Salários', 'Conta Reduzida': '900' } },
      { numero: 3, celulas: { Classificação: '4', Descrição: 'DESPESAS', 'Conta Reduzida': null } },
    ]);
  });

  it('cabeçalho depois de linhas de título, até a linha máxima', async () => {
    const x = await planilha([['Título da minuta'], ['Revisão'], [], COLUNAS, ['4', 'DIREX', '14.180']]);
    const r = await ler(x, { linhaCabecalhoMax: 10 });
    expect(r.ok && r.valor.linhas.map((l) => l.numero)).toEqual([5]);
    const longe = await ler(x, { linhaCabecalhoMax: 3 });
    expect(longe).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'arquivo' })] });
  });

  it('sem as colunas esperadas → erro de arquivo citando as colunas', async () => {
    const r = await ler(await planilha([['A', 'B'], ['1', '2']]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros[0]!.mensagem).toContain('Classificação, Descrição, Conta Reduzida');
  });

  it('1234.56 vira "1234.56"; 3 casas e 15 dígitos são recusados na linha, sem citar o valor', async () => {
    const x = await planilha([COLUNAS, ['a', 'x', 1234.56], ['b', 'x', 1234.567], ['c', 'x', 123456789012345], ['d', 'x', 12345678901234]]);
    const r = await ler(x);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.linhas[0]!.celulas['Conta Reduzida']).toBe('1234.56');
    expect(r.valor.linhas[3]!.celulas['Conta Reduzida']).toBe('12345678901234');
    expect(r.valor.errosCelula).toEqual([
      { linha: 3, coluna: 'Conta Reduzida', mensagem: 'Número com mais de 2 casas decimais.' },
      { linha: 4, coluna: 'Conta Reduzida', mensagem: 'Número com dígitos demais.' },
    ]);
    expect(JSON.stringify(r.valor.errosCelula)).not.toMatch(/1234|12345/);
  });

  it('fórmula com resultado vale o resultado; sem resultado é erro na linha', async () => {
    const x = await planilha([
      COLUNAS,
      ['a', { formula: 'CONCAT("Sal","ários")', result: 'Salários' }, 900],
      ['b', { formula: 'A1&B1' }, 910],
    ]);
    const r = await ler(x);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.linhas[0]!.celulas.Descrição).toBe('Salários');
    expect(r.valor.errosCelula).toEqual([{ linha: 3, coluna: 'Descrição', mensagem: expect.stringContaining('Fórmula sem resultado') }]);
  });

  it('célula de 1.001 caracteres → erro na linha', async () => {
    const r = await ler(await planilha([COLUNAS, ['a', 'x'.repeat(1001), 1]]));
    expect(r.ok && r.valor.errosCelula).toEqual([{ linha: 2, coluna: 'Descrição', mensagem: 'Célula com mais de 1000 caracteres.' }]);
  });

  it('20.001 linhas → erro de arquivo', async () => {
    const linhas: unknown[][] = [COLUNAS];
    for (let i = 0; i < 20_000; i++) linhas.push([String(i), 'x', i]);
    const r = await ler(await planilha(linhas));
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'A planilha passa de 20000 linhas.' }] });
  }, 60_000);

  it('31 colunas → erro de arquivo', async () => {
    const r = await ler(await planilha([[...COLUNAS, ...Array.from({ length: 28 }, (_, i) => `C${i}`)]]));
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'A planilha passa de 30 colunas.' }] });
  });

  it('escolhe a aba pelo nome; aba inexistente é erro', async () => {
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]], { outraAbaAntes: true });
    const r = await ler(x, { aba: 'plano de contas' });
    expect(r.ok && r.valor.linhas).toHaveLength(1);
    expect(await ler(x, { aba: 'Outra' })).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'A aba "Outra" não foi encontrada.' }] });
  });
});

describe('lerPlanilhaSegura — arquivo hostil', () => {
  it('XML com <!DOCTYPE ou <!ENTITY é recusado', async () => {
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    for (const injecao of ['<!DOCTYPE x [<!ENTITY a "b">]>', '<!entity a "b">']) {
      const entradas = lerZipSeguro(x, LIMITES_PADRAO);
      const nome = 'xl/worksheets/sheet1.xml';
      const xml = new TextDecoder().decode(entradas.get(nome));
      const adulterado = xml.replace('<worksheet', `${injecao}<worksheet`);
      expect(adulterado).toContain(injecao);
      entradas.set(nome, new TextEncoder().encode(adulterado));
      const r = await ler(empacotarSemCompressao(entradas));
      expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida ou grande demais.' }] });
    }
  });

  it('o que não é zip é recusado com a mensagem genérica', async () => {
    const r = await ler(new TextEncoder().encode('isto definitivamente não é uma planilha do Excel'));
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida ou grande demais.' }] });
  });

  it('duas leituras simultâneas: a segunda recebe a mensagem do semáforo', async () => {
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    const [a, b] = await Promise.all([ler(x), ler(x)]);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Outra planilha está sendo lida. Tente de novo em instantes.' }] });
    // Depois que a primeira termina, o semáforo é liberado.
    expect((await ler(x)).ok).toBe(true);
  });

  it('o semáforo é liberado também quando a leitura falha', async () => {
    await ler(new Uint8Array(10));
    expect((await ler(await planilha([COLUNAS, ['4', 'x', null]]))).ok).toBe(true);
  });
});

describe('sanearNomeArquivo', () => {
  it('tira caminho e caractere de controle, com até 120 caracteres', () => {
    expect(sanearNomeArquivo('../../x\u0007.xlsx')).toBe('x.xlsx');
    expect(sanearNomeArquivo('C:\\Users\\a\\plano.xlsx')).toBe('plano.xlsx');
    expect(sanearNomeArquivo('a\u202Egpj.xlsx')).toBe('agpj.xlsx');
    expect(sanearNomeArquivo(`${'n'.repeat(200)}.xlsx`)).toHaveLength(120);
    expect(sanearNomeArquivo('..')).toBe('planilha.xlsx');
  });
});
