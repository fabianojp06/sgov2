import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { criarIdentificacao, type PlanilhaExportacao } from './exportacao';
import { exportarPdf, quebrar } from './exportar-pdf';

// Exportação PDF (US-024): gerar e ler de volta o texto de cada página, sem confiar no gerador.
// Leitor mínimo: descomprime os content streams e decodifica as strings hex dos Tj (WinAnsi: o
// Latin-1, mais os poucos caracteres de 0x80 a 0x9F usados aqui).
const WIN_ANSI: Record<number, string> = { 0x85: '…', 0x96: '–', 0x97: '—' };
const winAnsi = (hex: string) => Array.from(Buffer.from(hex, 'hex'), (b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join('');
async function paginas(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => {
    const conteudo = p.node.Contents();
    const itens = conteudo instanceof PDFArray ? conteudo.asArray().map((x) => doc.context.lookup(x)) : [conteudo];
    const streams = itens.filter((s): s is PDFRawStream => s instanceof PDFRawStream);
    const texto = streams.map((s) => (s.dict.get(PDFName.of('Filter')) ? inflateSync(s.contents) : Buffer.from(s.contents)).toString('latin1')).join('\n');
    return [...texto.matchAll(/<([0-9A-Fa-f]*)> Tj/g)].map((m) => winAnsi(m[1]!));
  });
}

function bytes(r: Awaited<ReturnType<typeof exportarPdf>>): Uint8Array {
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}

const identificacao = criarIdentificacao(
  { titulo: 'Plano de contas', filtros: [{ rotulo: 'Tipo', valor: 'Analítica' }], operador: 'gfin' },
  new Date('2026-11-10T15:00:00.000Z'),
  '0a1b2c3d-0000-4000-8000-000000000001',
);
const planilha = (linhas: PlanilhaExportacao['linhas'], extra: Partial<PlanilhaExportacao> = {}): PlanilhaExportacao => ({
  nome: 'Contas',
  colunas: [
    { titulo: 'Conta', tipo: 'texto', largura: 200 },
    { titulo: 'Valor', tipo: 'dinheiro' },
  ],
  linhas,
  identificacao,
  ...extra,
});

describe('exportarPdf', () => {
  it('PDF 1.7 com os metadados do operador e do rastreio', async () => {
    const b = bytes(await exportarPdf([planilha([['4.1.1', '1234.5']])]));
    expect(new TextDecoder().decode(b.slice(0, 8))).toBe('%PDF-1.7');
    const doc = await PDFDocument.load(b, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Plano de contas');
    expect(doc.getAuthor()).toBe('gfin');
    expect(doc.getSubject()).toBe('Rastreio 0a1b2c3d-0000-4000-8000-000000000001');
    expect(doc.getProducer()).toBe('SGO 2.0');
    expect(doc.getCreationDate()).toEqual(new Date('2026-11-10T15:00:00.000Z'));
  });

  it('primeira página: cabeçalho legível, títulos das colunas, valores como na tela e o rodapé', async () => {
    const [p] = await paginas(bytes(await exportarPdf([planilha([['4.1.1 Pessoal', '1234.5']])])));
    expect(p).toEqual([
      'Plano de contas',
      'Filtros: Tipo: Analítica',
      'Exportado por gfin em 10/11/2026, 12:00 (horário de Brasília)',
      'Rastreio: 0a1b2c3d-0000-4000-8000-000000000001',
      'Conta',
      'Valor',
      '4.1.1 Pessoal',
      expect.stringMatching(/1\.234,50$/),
      'Exportado por gfin · Rastreio 0a1b2c3d-0000-4000-8000-000000000001',
      'Página 1 de 1',
    ]);
  });

  it('muitas linhas: várias páginas, cada uma com o título, os títulos das colunas e o rodapé numerado', async () => {
    const linhas = Array.from({ length: 200 }, (_, i) => [`Conta ${i + 1}`, '1.00']);
    const ps = await paginas(bytes(await exportarPdf([planilha(linhas)])));
    expect(ps.length).toBeGreaterThan(2);
    ps.forEach((p, i) => {
      expect(p[0]).toBe('Plano de contas');
      expect(p).toContain('Conta');
      expect(p.at(-1)).toBe(`Página ${i + 1} de ${ps.length}`);
      expect(p.at(-2)).toBe('Exportado por gfin · Rastreio 0a1b2c3d-0000-4000-8000-000000000001');
    });
    // O cabeçalho completo só na primeira página; nenhuma linha se perde nem se repete.
    expect(ps.slice(1).flat()).not.toContain('Filtros: Tipo: Analítica');
    const dados = ps.flat().filter((t) => /^Conta \d+$/.test(t));
    expect(dados).toEqual(linhas.map((l) => l[0]));
  });

  it('cada aba começa numa página nova; sem linhas, "Nenhum registro."', async () => {
    const ps = await paginas(bytes(await exportarPdf([planilha([['A', null]]), planilha([], { nome: 'Vazia', identificacao: { ...identificacao, titulo: 'Outra' } })])));
    expect(ps).toHaveLength(2);
    expect(ps[1]![0]).toBe('Outra');
    expect(ps[1]).toContain('Nenhum registro.');
    expect(ps[1]!.at(-1)).toBe('Página 2 de 2');
  });

  it('sem identificação: o nome da aba como título e o rodapé só com a numeração', async () => {
    const { nome, colunas } = planilha([]);
    const [p] = await paginas(bytes(await exportarPdf([{ nome, colunas, linhas: [['A', '1']] }])));
    expect(p![0]).toBe('Contas');
    expect(p!.at(-1)).toBe('Página 1 de 1');
    expect(p!.join('|')).not.toContain('Rastreio');
  });

  it('caractere fora das fontes padrão vira "?", e controle vira espaço', async () => {
    const [p] = await paginas(bytes(await exportarPdf([planilha([['Seta → e emoji 😀 e\tTAB', '1']])])));
    expect(p).toContain('Seta ? e emoji ? e TAB');
  });

  it('texto longo quebra na largura da coluna e para em 8 linhas, com "…"', async () => {
    const longo = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(' ');
    const [p] = await paginas(bytes(await exportarPdf([planilha([[longo, '1']])])));
    const pedacos = p!.filter((t) => t.startsWith('palavra') || t.includes(' palavra'));
    expect(pedacos).toHaveLength(8);
    expect(pedacos.at(-1)).toMatch(/…$/);
  });

  it('cabeçalho longo (30 filtros de 200 caracteres): nenhum filtro se perde, e o cabeçalho continua na página seguinte', async () => {
    const filtros = Array.from({ length: 30 }, (_, i) => ({ rotulo: `F${i}`, valor: `${'v'.repeat(190)}${i}` }));
    const ident = { ...identificacao, filtros };
    const ps = await paginas(bytes(await exportarPdf([planilha([['A', '1']], { identificacao: ident })])));
    const texto = ps.flat().join('').replaceAll(' ', '');
    for (let i = 0; i < 30; i++) expect(texto).toContain(`F${i}:${'v'.repeat(190)}${i}`);
    expect(ps.flat().join('|')).not.toContain('…');
    expect(ps.length).toBeGreaterThan(1);
    // A tabela vem depois do cabeçalho inteiro.
    expect(ps.at(-1)).toContain('A');
  });

  it('título longo quebra em até 3 linhas; operador longo não passa por cima da numeração', async () => {
    const ident = { ...identificacao, titulo: 'Título '.repeat(28).trim(), operador: 'o'.repeat(200) };
    const [p] = await paginas(bytes(await exportarPdf([planilha([['A', '1']], { identificacao: ident })])));
    const doc = await PDFDocument.load(bytes(await exportarPdf([planilha([['A', '1']], { identificacao: ident })])), { updateMetadata: false });
    expect(doc.getTitle()).toBe(ident.titulo);
    const titulo = p!.slice(0, p!.findIndex((t) => t.startsWith('Filtros:')));
    expect(titulo.length).toBeGreaterThan(1);
    expect(titulo.length).toBeLessThanOrEqual(3);
    expect(titulo.join(' ')).toBe(ident.titulo);
    expect(p!.at(-2)).toMatch(/^Exportado por o+…$/);
    expect(p!.at(-1)).toBe('Página 1 de 1');
  });

  it('coluna mais estreita que um caractere: termina, com um caractere por linha e o corte em 8', async () => {
    const colunas = Array.from({ length: 70 }, (_, i) => ({ titulo: `C${i}`, tipo: 'texto' as const }));
    const r = await exportarPdf([{ nome: 'Larga', colunas, linhas: [colunas.map(() => 'WWW')] }]);
    expect(r.ok).toBe(true);
  });

  it('mesma entrada, mesmo arquivo (a data vem da identificação)', async () => {
    const a = bytes(await exportarPdf([planilha([['A', '1']])]));
    const b = bytes(await exportarPdf([planilha([['A', '1']])]));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('acima do limite: recusa com a mensagem da validação, sem gerar', async () => {
    const r = await exportarPdf([planilha([['A', '1'], ['B', '2']])], { limite: 1 });
    expect(!r.ok && r.erros.map((e) => e.campo)).toEqual(['linhas']);
  });
});

describe('quebrar', () => {
  const fonte = { widthOfTextAtSize: (t: string) => t.length * 5 };
  it('por palavra, e a palavra maior que a largura é partida', () => {
    expect(quebrar('aa bb cc', 25, fonte)).toEqual(['aa bb', 'cc']);
    expect(quebrar('abcdefghij', 25, fonte)).toEqual(['abcde', 'fghij']);
    expect(quebrar('', 25, fonte)).toEqual(['']);
  });

  it('largura menor que um caractere: um caractere por linha, sem laço infinito', () => {
    expect(quebrar('ab', 3, fonte)).toEqual(['a', 'b']);
    expect(quebrar('abc', 0, fonte, 2)).toEqual(['a', '…']);
  });
});
