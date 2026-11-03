import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { enderecoCelula, lerPlanilhaSegura, lerPlanilhasSegura, LIMITES_PADRAO, MSG_LEITOR_OCUPADO, sanearNomeArquivo } from './ler-xlsx';
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

describe('lerPlanilhaSegura — revisão 12.12, rodada 2', () => {
  it('prazo estourado: recusa, sem derrubar o processo, e a leitura seguinte funciona', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const linhas: unknown[][] = [COLUNAS];
    for (let i = 0; i < 5000; i++) linhas.push([String(i), 'x', i]);
    const x = await planilha(linhas);
    const r = await ler(x, { prazoMs: 1 });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida ou grande demais.' }] });
    expect(aviso).toHaveBeenCalledWith('[PLANILHA_RECUSADA]', { motivo: 'prazo de leitura' });
    expect((await ler(x)).ok).toBe(true);
    aviso.mockRestore();
  });

  it('.rels com uma sequência longa sem "=" é lido em tempo linear', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    const entradas = lerZipSeguro(x, LIMITES_PADRAO);
    const rels = comoTexto(entradas.get('xl/_rels/workbook.xml.rels')).replace('</Relationships>', `<Relationship ${'a'.repeat(200_000)}/></Relationships>`);
    entradas.set('xl/_rels/workbook.xml.rels', doTexto(rels));
    const inicio = performance.now();
    const r = await ler(empacotarSemCompressao(entradas));
    expect(performance.now() - inicio).toBeLessThan(1000);
    expect(r.ok).toBe(true);
    // Acima de 256 KB, o workbook nem é examinado.
    entradas.set('xl/_rels/workbook.xml.rels', doTexto(rels.replace('</Relationships>', `<!--${'b'.repeat(300_000)}--></Relationships>`)));
    expect((await ler(empacotarSemCompressao(entradas))).ok).toBe(false);
    vi.restoreAllMocks();
  });

  it('entidade numérica fora do Unicode no nome da aba devolve Resultado (não rejeita)', async () => {
    const x = await planilha([COLUNAS, ['4', 'DESPESAS', null]]);
    const entradas = lerZipSeguro(x, LIMITES_PADRAO);
    const wb = comoTexto(entradas.get('xl/workbook.xml')).replace(/name="Plano de Contas"/, 'name="&#99999999;&#xD800;"');
    entradas.set('xl/workbook.xml', doTexto(wb));
    const r = await ler(empacotarSemCompressao(entradas), { aba: 'Plano de Contas' });
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'A aba "Plano de Contas" não foi encontrada.' }] });
  });
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

describe('lerPlanilhasSegura — várias abas numa chamada (#231)', () => {
  async function tresAbas(): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Pessoal').addRows([['Cargo', 'Qtd'], ['Analista', 2]]);
    wb.addWorksheet('Pacotes').addRows([['Conta', 'Valor'], ['4.1', 10.5], ['4.2', 3]]);
    wb.addWorksheet('Receitas').addRows([['TP', 'Valor'], ['TP1', 100]]);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }
  const pedidos = [
    { aba: 'Pessoal', colunas: ['Cargo', 'Qtd'], linhaCabecalhoMax: 4 },
    { aba: 'Pacotes', colunas: ['Conta', 'Valor'], linhaCabecalhoMax: 4 },
    { aba: 'Receitas', colunas: ['TP', 'Valor'], linhaCabecalhoMax: 4 },
  ];

  it('lê as três abas na ordem pedida, com as colunas de cada uma', async () => {
    const r = await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: await tresAbas() }, pedidos);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.valor.map((p) => p.linhas.map((l) => l.celulas))).toEqual([
      [{ Cargo: 'Analista', Qtd: '2' }],
      [
        { Conta: '4.1', Valor: '10.5' },
        { Conta: '4.2', Valor: '3' },
      ],
      [{ TP: 'TP1', Valor: '100' }],
    ]);
    expect(r.valor.every((p) => p.nomeArquivo === 'orc.xlsx')).toBe(true);
  });

  it('o semáforo fica preso entre as abas: uma leitura concorrente é recusada com o texto exato do contrato', async () => {
    const x = await tresAbas();
    const [a, b] = await Promise.all([lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, pedidos), ler(x)]);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: MSG_LEITOR_OCUPADO }] });
    expect(MSG_LEITOR_OCUPADO).toBe('Outra planilha está sendo lida. Tente de novo em instantes.');
    // E a de uma aba também segura a de várias.
    const [c, d] = await Promise.all([ler(await planilha([COLUNAS, ['4', 'DESPESAS', null]])), lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, pedidos)]);
    expect(c.ok).toBe(true);
    expect(d).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: MSG_LEITOR_OCUPADO }], indiceAba: null });
  });

  it('erro numa aba reprova tudo e diz qual (indiceAba); erro do arquivo, indiceAba null; o semáforo é liberado', async () => {
    const x = await tresAbas();
    const r = await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, [pedidos[0]!, { aba: 'Inexistente', colunas: ['A'], linhaCabecalhoMax: 4 }]);
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'A aba "Inexistente" não foi encontrada.' }], indiceAba: 1 });
    // Cabeçalho fora do layout na 3ª aba (R6 do orc precisa saber qual).
    const cab = await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, [pedidos[0]!, pedidos[1]!, { ...pedidos[2]!, colunas: ['TP', 'Outra'] }]);
    expect(cab).toMatchObject({ ok: false, indiceAba: 2 });
    // Limite de linhas por aba: a Pacotes tem 2 linhas de dados.
    const limite = await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, [pedidos[0]!, { ...pedidos[1]!, limites: { linhas: 1 } }]);
    expect(limite).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'A planilha passa de 1 linhas.' }], indiceAba: 1 });
    // Limite do zip na chamada.
    expect(await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, pedidos, { bytes: 100 })).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida ou grande demais.' }], indiceAba: null });
    const zipRuim = await lerPlanilhasSegura({ nome: 'x.xlsx', conteudo: new Uint8Array(10) }, pedidos);
    expect(zipRuim).toMatchObject({ ok: false, indiceAba: null });
    expect((await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, pedidos)).ok).toBe(true);
  });

  it('sem abas, mais de 10 ou repetidas: erro do chamador; o semáforo não fica preso', async () => {
    const x = await tresAbas();
    await expect(lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, [])).rejects.toThrow('de 1 a 10 abas');
    await expect(lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, [pedidos[0]!, { ...pedidos[0]!, aba: 'PESSOAL' }])).rejects.toThrow('sem repetir');
    await expect(lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, Array.from({ length: 11 }, (_, i) => ({ ...pedidos[0]!, aba: `A${i}` })))).rejects.toThrow();
    expect((await ler(await planilha([COLUNAS, ['4', 'DESPESAS', null]]))).ok).toBe(true);
  });

  it('o prazo é um só para a chamada: esgotado, a aba seguinte é recusada com o índice', async () => {
    const x = await tresAbas();
    const agora = vi.spyOn(Date, 'now');
    let t = 0;
    agora.mockImplementation(() => (t += 20_000));
    const r = await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, pedidos);
    agora.mockRestore();
    expect(r).toEqual({ ok: false, erros: [{ campo: 'arquivo', mensagem: 'Planilha inválida ou grande demais.' }], indiceAba: 1 });
    expect((await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: x }, pedidos)).ok).toBe(true);
  });
});

describe('células avulsas (#232)', () => {
  async function comInstrucoes(versao: unknown): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    const ins = wb.addWorksheet('Instruções');
    ins.getCell('A1').value = 'Preencha as abas abaixo.';
    ins.getCell('E1').value = versao as ExcelJS.CellValue;
    ins.getCell('B3').value = 'Responsável';
    wb.addWorksheet('Plano de Contas').addRows([COLUNAS, ['4', 'DESPESAS', null]]);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it('lê Instruções!E1 numa aba sem tabela (colunas: []), junto das outras abas', async () => {
    const r = await lerPlanilhasSegura({ nome: 'orc.xlsx', conteudo: await comInstrucoes('ADMC-ORC v1.0') }, [
      { aba: 'Instruções', colunas: [], linhaCabecalhoMax: 1, celulas: ['E1', 'B3', 'C9'] },
      { aba: 'Plano de Contas', colunas: COLUNAS, linhaCabecalhoMax: 10 },
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.valor[0]!.celulasAvulsas).toEqual({ E1: 'ADMC-ORC v1.0', B3: 'Responsável', C9: null });
    expect(r.valor[0]!.linhas).toEqual([]);
    expect(r.valor[1]!.celulasAvulsas).toBeUndefined();
    expect(r.valor[1]!.linhas).toHaveLength(1);
  });

  it('célula com fórmula sem resultado: erro de célula pelo endereço, sem o conteúdo', async () => {
    const r = await lerPlanilhaSegura({ nome: 'orc.xlsx', conteudo: await comInstrucoes({ formula: 'A1' }) }, { aba: 'Instruções', colunas: [], linhaCabecalhoMax: 1, celulas: ['E1'] });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.valor.celulasAvulsas).toEqual({ E1: null });
    expect(r.valor.errosCelula).toEqual([{ linha: 1, coluna: 'E1', mensagem: 'Fórmula sem resultado calculado. Salve a planilha no Excel e envie de novo.' }]);
  });

  it('endereço: formato A1, coluna e linha dentro dos limites; fora disso, erro do chamador', async () => {
    expect(enderecoCelula('E1')).toEqual({ linha: 1, coluna: 5 });
    expect(enderecoCelula('AA10')).toEqual({ linha: 10, coluna: 27 });
    for (const e of ['e1', 'E0', '1E', 'E1001', 'E1:F2', '']) expect(enderecoCelula(e), e).toBeNull();
    const x = await comInstrucoes('v');
    await expect(lerPlanilhaSegura({ nome: 'o.xlsx', conteudo: x }, { aba: 'Instruções', colunas: [], linhaCabecalhoMax: 1, celulas: ['AF1'] })).rejects.toThrow('formato A1');
    await expect(lerPlanilhaSegura({ nome: 'o.xlsx', conteudo: x }, { aba: 'Instruções', colunas: [], linhaCabecalhoMax: 1, celulas: Array.from({ length: 21 }, (_, i) => `A${i + 1}`) })).rejects.toThrow();
    // O semáforo foi liberado.
    expect((await ler(await planilha([COLUNAS, ['4', 'DESPESAS', null]]))).ok).toBe(true);
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
