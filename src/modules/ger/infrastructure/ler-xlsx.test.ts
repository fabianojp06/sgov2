import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
    for (let i = 0; i <= 20_000; i++) linhas.push([String(i), 'x', i]);
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

// Zip compactado (deflate) com as entradas dadas: para os arquivos hostis que precisam caber em 1 MB.
function zipCompactado(entradas: Iterable<[string, Uint8Array]>): Uint8Array {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let pos = 0;
  let n = 0;
  for (const [nome, dados] of entradas) {
    const nb = Buffer.from(nome);
    const comp = deflateRawSync(dados, { level: 9 });
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30 + nb.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nb.length, 26);
    nb.copy(local, 30);
    const central = Buffer.alloc(46 + nb.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nb.length, 28);
    central.writeUInt32LE(pos, 42);
    nb.copy(central, 46);
    locais.push(local, comp);
    centrais.push(central);
    pos += local.length + comp.length;
    n++;
  }
  const tam = centrais.reduce((t, c) => t + c.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(n, 8);
  fim.writeUInt16LE(n, 10);
  fim.writeUInt32LE(tam, 12);
  fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}

const comoTexto = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const doTexto = (s: string) => new TextEncoder().encode(s);

describe('lerPlanilhaSegura — revisão 12.12', () => {
  it('entrada isca com nome parecido (e DTD) não chega ao ExcelJS: vale a aba do workbook', async () => {
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    const entradas = lerZipSeguro(x, LIMITES_PADRAO);
    const isca = comoTexto(entradas.get('xl/worksheets/sheet1.xml')).replace('DESPESAS', 'ISCA').replace('<worksheet', '<!DOCTYPE x><worksheet');
    entradas.set('zz/xl/worksheets/sheet1.xml.bak', doTexto(isca));
    for (const aba of [undefined, 'Plano de Contas']) {
      const r = await ler(empacotarSemCompressao(entradas), aba ? { aba } : {});
      expect(r.ok && r.valor.linhas.map((l) => l.celulas.Descrição)).toEqual(['DESPESAS']);
    }
  });

  it('alvo absoluto no .rels e sem sharedStrings (formato de outros geradores)', async () => {
    const x = await planilha([COLUNAS, [1, 2, 3]]);
    const entradas = lerZipSeguro(x, LIMITES_PADRAO);
    const rels = comoTexto(entradas.get('xl/_rels/workbook.xml.rels')).replace(/Target="worksheets\//g, 'Target="/xl/worksheets/');
    expect(rels).toContain('Target="/xl/worksheets/sheet1.xml"');
    entradas.set('xl/_rels/workbook.xml.rels', doTexto(rels));
    // Sem sharedStrings, o cabeçalho vem como texto embutido na célula.
    const folha = comoTexto(entradas.get('xl/worksheets/sheet1.xml')).replace(/<c r="([A-C])1"[^>]*t="s"[^>]*><v>(\d)<\/v><\/c>/g, (_m, col: string, i: string) =>
      `<c r="${col}1" t="inlineStr"><is><t>${COLUNAS[Number(i)]}</t></is></c>`,
    );
    entradas.set('xl/worksheets/sheet1.xml', doTexto(folha));
    entradas.delete('xl/sharedStrings.xml');
    const r = await ler(empacotarSemCompressao(entradas), { aba: 'Plano de Contas' });
    expect(r).toMatchObject({ ok: true, valor: { linhas: [{ numero: 2, celulas: { Classificação: '1', Descrição: '2', 'Conta Reduzida': '3' } }] } });
  });

  it('<!ENTITY no sharedStrings é recusado pelo filtro (motivo no log, sem conteúdo)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    const entradas = lerZipSeguro(x, LIMITES_PADRAO);
    entradas.set('xl/sharedStrings.xml', doTexto(comoTexto(entradas.get('xl/sharedStrings.xml')).replace('<sst', '<!ENTITY a "b"><sst')));
    const r = await ler(empacotarSemCompressao(entradas));
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida ou grande demais.' }] });
    expect(aviso).toHaveBeenCalledWith('[PLANILHA_RECUSADA]', { motivo: 'xml com DTD' });
    aviso.mockRestore();
  });

  it('XML em UTF-16 é recusado', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    const entradas = lerZipSeguro(x, LIMITES_PADRAO);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(comoTexto(entradas.get('xl/sharedStrings.xml')), 'utf16le')]);
    entradas.set('xl/sharedStrings.xml', utf16);
    expect((await ler(empacotarSemCompressao(entradas))).ok).toBe(false);
    vi.restoreAllMocks();
  });

  it('coluna só de texto recusa célula numérica; caracteres invisíveis saem do texto', async () => {
    const x = await planilha([COLUNAS, ['4.3', 'A\u200Bb\u202Ec', 14.18]]);
    const r = await ler(x, { colunasTexto: ['Conta Reduzida'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.linhas[0]!.celulas.Descrição).toBe('Abc');
    expect(r.valor.errosCelula).toEqual([{ linha: 2, coluna: 'Conta Reduzida', mensagem: expect.stringContaining('deve ser texto') }]);
  });

  it('bordas aceitas: 1.000 caracteres, 30 colunas e 20.000 linhas', async () => {
    const linhas: unknown[][] = [[...COLUNAS, ...Array.from({ length: 27 }, (_, i) => `C${i}`)]];
    linhas.push(['a', 'x'.repeat(1000), 1]);
    for (let i = 1; i < 20_000; i++) linhas.push([String(i), 'x', i]);
    expect(linhas).toHaveLength(20_001);
    const r = await ler(await planilha(linhas));
    expect(r.ok && r.valor.errosCelula).toEqual([]);
    expect(r.ok && r.valor.linhas).toHaveLength(20_000);
  }, 60_000);
});

describe('lerPlanilhaSegura — memória num processo com 256 MB de heap', () => {
  // Dentro do repositório, para o processo filho achar o exceljs em node_modules.
  const pasta = mkdtempSync(join(process.cwd(), 'node_modules', '.sgo-xlsx-'));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  it('19 MB de strings ou de linhas em um arquivo pequeno não derrubam o processo', async () => {
    const base = lerZipSeguro(await planilha([COLUNAS, ['4', 'DESPESAS', null]]), LIMITES_PADRAO);
    // Um comentário aleatório deixa a razão de compressão abaixo de 100 (passa pelo zip seguro).
    const ruido = `<!--${randomBytes(150_000).toString('base64')}-->`;
    const strings = new Map(base);
    strings.set('xl/sharedStrings.xml', doTexto(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${'<si><t>a</t></si>'.repeat(1_100_000)}</sst>${ruido}`));
    const linhas = new Map(base);
    const folha = comoTexto(base.get('xl/worksheets/sheet1.xml'));
    linhas.set('xl/worksheets/sheet1.xml', doTexto(folha.replace('</sheetData>', `${'<row><c><v>1</v></c></row>'.repeat(700_000)}</sheetData>${ruido}`)));
    for (const [nome, m] of [['strings.xlsx', strings], ['linhas.xlsx', linhas]] as const) {
      const z = zipCompactado(m);
      expect(z.length).toBeLessThan(LIMITES_PADRAO.bytes);
      writeFileSync(join(pasta, nome), z);
    }
    const leitor = join(pasta, 'leitor.mjs');
    await build({
      entryPoints: ['src/modules/ger/infrastructure/ler-xlsx.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: leitor,
      tsconfig: 'tsconfig.json',
      external: ['exceljs'],
      logLevel: 'warning',
    });
    const roteiro = `
      import { readFileSync } from 'node:fs';
      import { lerPlanilhaSegura } from ${JSON.stringify(leitor)};
      console.warn = () => {};
      let pico = 0;
      const medir = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 20);
      for (const nome of ['strings.xlsx', 'linhas.xlsx']) {
        const r = await lerPlanilhaSegura({ nome, conteudo: readFileSync(${JSON.stringify(pasta)} + '/' + nome) },
          { colunas: ['Classificação', 'Descrição', 'Conta Reduzida'], linhaCabecalhoMax: 10 });
        console.log(nome, r.ok ? 'ok' : r.erros[0].mensagem);
      }
      clearInterval(medir);
      console.log('pico', Math.round(pico / 1048576));
    `;
    const saida = execFileSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', roteiro], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    // O que importa é o processo terminar (sem OOM) e devolver um resultado para cada arquivo.
    expect(saida).toMatch(/^strings\.xlsx .+$/m);
    expect(saida).toMatch(/^linhas\.xlsx .+$/m);
    expect(Number(/pico (\d+)/.exec(saida)?.[1])).toBeLessThan(600);
  }, 120_000);
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
