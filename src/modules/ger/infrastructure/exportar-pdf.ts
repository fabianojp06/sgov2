import type { Color, PDFFont, PDFPage } from 'pdf-lib';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { formatarCelula, type TipoColuna } from '../domain/celula';
import { linhasIdentificacao, validarPlanilhas, type OpcoesGeracao, type PlanilhaExportacao } from './exportacao';

// Contrato C3: exportação para PDF (US-024; PDF 1.7, ISO 32000-1), na mesma forma do XLSX e do CSV.
// Só pelo servidor.ts, como o XLSX. A4 paisagem, Helvetica (fontes padrão do PDF: nada é lido do
// disco, e o arquivo cabe no bundle único do worker). Cada aba começa numa página nova, com o
// cabeçalho legível (RN0011) na primeira página; toda página repete o título e os títulos das colunas
// e leva no rodapé o operador, o rastreio e a numeração (RN_WATERMARK). Os valores saem como na tela
// (formatarCelula); o PDF não avalia fórmula, então não há escape de = + - @.
export async function exportarPdf(planilhas: readonly PlanilhaExportacao[], opcoes: OpcoesGeracao = {}): Promise<Resultado<Uint8Array>> {
  const v = validarPlanilhas(planilhas, opcoes.limite);
  if (!v.ok) return falha(v.erros);
  try {
    return ok(await gerar(planilhas));
  } catch (e) {
    // No log, só a classe e a mensagem do pdf-lib, sem os dados das células.
    console.error('[PDF_FALHOU]', { erro: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'desconhecido' });
    return falha([{ campo: 'planilhas', mensagem: 'Não foi possível gerar o PDF.' }]);
  }
}

const LARGURA = 841.89; // A4 paisagem, em pontos
const ALTURA = 595.28;
const MARGEM = 36;
const TAMANHO = 8;
const TAMANHO_TITULO = 12;
const ENTRELINHA = 10;
const RESPIRO = 3; // espaço interno da célula
const MAX_LINHAS_CELULA = 8; // texto além disso termina em "…"
const MAX_LINHAS_TITULO = 3;
const FIM_DA_AREA = MARGEM + 2 * ENTRELINHA; // abaixo disso, só o rodapé
const LARGURA_PADRAO = 120; // em px, como o `largura` da tela
const CINZA = { linha: 0.8, cabecalho: 0.92, rodape: 0.35 };

async function gerar(planilhas: readonly PlanilhaExportacao[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, grayscale } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  // Só o que a codificação das fontes padrão (WinAnsi) aceita; o resto vira "?". Controle vira espaço.
  const aceitos = new Set(fonte.getCharacterSet());
  const limpo = (t: string) =>
    Array.from(t, (c) => {
      const cp = c.codePointAt(0)!;
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return ' ';
      return aceitos.has(cp) ? c : '?';
    }).join('');
  const rodapes: { pagina: PDFPage; texto: string }[] = [];

  for (const p of planilhas) {
    const titulo = limpo(p.identificacao?.titulo ?? p.nome);
    const marca = p.identificacao ? limpo(`Exportado por ${p.identificacao.operador} · Rastreio ${p.identificacao.rastreio}`) : '';
    const util = LARGURA - 2 * MARGEM;
    const pesos = p.colunas.map((c) => c.largura ?? LARGURA_PADRAO);
    const soma = pesos.reduce((a, b) => a + b, 0) || 1;
    const larguras = pesos.map((w) => (w / soma) * util);
    const direita = p.colunas.map((c) => alinhaDireita(c.tipo));
    const titulos = p.colunas.map((c, i) => quebrar(limpo(c.titulo), larguras[i]! - 2 * RESPIRO, negrito));

    // O título quebra em até 3 linhas na largura da página.
    const linhasTitulo = quebrar(titulo, util, negrito, MAX_LINHAS_TITULO, TAMANHO_TITULO);

    let pagina!: PDFPage;
    let y!: number;
    const abrirPagina = () => {
      pagina = doc.addPage([LARGURA, ALTURA]);
      rodapes.push({ pagina, texto: marca });
      y = ALTURA - MARGEM;
      for (const l of linhasTitulo) {
        escrever(pagina, l, MARGEM, y - TAMANHO_TITULO, negrito, TAMANHO_TITULO);
        y -= TAMANHO_TITULO + 2;
      }
      y -= 4;
    };
    const cabecalhoDasColunas = () => {
      y = desenharLinha(pagina, y, titulos, larguras, direita, negrito, grayscale(CINZA.cabecalho), grayscale(CINZA.linha));
    };
    const cabe = (altura: number) => y - altura >= FIM_DA_AREA;

    abrirPagina();
    if (p.identificacao) {
      // RN0011: o cabeçalho legível completo (filtros, operador e hora, rastreio), sem corte; só no
      // começo da aba e, se for longo, continua na página seguinte.
      for (const l of linhasIdentificacao(p.identificacao).slice(1).flatMap((t) => quebrar(limpo(t), util, fonte, Infinity))) {
        if (!cabe(ENTRELINHA)) abrirPagina();
        escrever(pagina, l, MARGEM, y - TAMANHO, fonte, TAMANHO);
        y -= ENTRELINHA;
      }
      y -= 6;
    }
    // Os títulos das colunas nunca ficam sozinhos no pé da página.
    if (!cabe(alturaDaLinha(titulos) + alturaDaLinha([['']]))) abrirPagina();
    cabecalhoDasColunas();
    if (p.linhas.length === 0) {
      escrever(pagina, 'Nenhum registro.', MARGEM + RESPIRO, y - TAMANHO - RESPIRO, fonte, TAMANHO);
    }
    for (const linha of p.linhas) {
      const celulas = linha.map((valor, i) => quebrar(limpo(formatarCelula(p.colunas[i]!.tipo, valor)), larguras[i]! - 2 * RESPIRO, fonte));
      if (!cabe(alturaDaLinha(celulas))) {
        abrirPagina();
        cabecalhoDasColunas();
      }
      y = desenharLinha(pagina, y, celulas, larguras, direita, fonte, undefined, grayscale(CINZA.linha));
    }
  }

  // Numeração no fim, quando o total de páginas é conhecido.
  rodapes.forEach(({ pagina, texto }, i) => {
    const numero = `Página ${i + 1} de ${rodapes.length}`;
    const cor = grayscale(CINZA.rodape);
    // A marca nunca passa por cima da numeração: o que não cabe termina em "…".
    const espaco = LARGURA - 2 * MARGEM - fonte.widthOfTextAtSize(numero, 7) - 12;
    if (texto) pagina.drawText(cortar(texto, espaco, fonte, 7), { x: MARGEM, y: MARGEM - 14, size: 7, font: fonte, color: cor });
    pagina.drawText(numero, { x: LARGURA - MARGEM - fonte.widthOfTextAtSize(numero, 7), y: MARGEM - 14, size: 7, font: fonte, color: cor });
  });

  const primeira = planilhas[0]!.identificacao;
  doc.setTitle(limpo(primeira?.titulo ?? planilhas[0]!.nome));
  doc.setProducer('SGO 2.0');
  doc.setCreator('SGO 2.0');
  if (primeira) {
    doc.setAuthor(limpo(primeira.operador));
    doc.setSubject(`Rastreio ${primeira.rastreio}`);
    doc.setCreationDate(new Date(primeira.geradoEm));
    doc.setModificationDate(new Date(primeira.geradoEm));
  }
  return doc.save();
}

const alinhaDireita = (t: TipoColuna) => t === 'dinheiro' || t === 'percentual';

const alturaDaLinha = (celulas: readonly string[][]) => Math.max(1, ...celulas.map((c) => c.length)) * ENTRELINHA + 2 * RESPIRO;

function escrever(pagina: PDFPage, texto: string, x: number, y: number, font: PDFFont, size: number) {
  if (texto) pagina.drawText(texto, { x, y, size, font });
}

/** Desenha uma linha da tabela a partir de y (topo) e devolve o novo topo. */
function desenharLinha(
  pagina: PDFPage,
  y: number,
  celulas: readonly string[][],
  larguras: readonly number[],
  direita: readonly boolean[],
  font: PDFFont,
  fundo: Color | undefined,
  borda: Color,
): number {
  const altura = alturaDaLinha(celulas);
  if (fundo) pagina.drawRectangle({ x: MARGEM, y: y - altura, width: larguras.reduce((a, b) => a + b, 0), height: altura, color: fundo });
  let x = MARGEM;
  celulas.forEach((linhas, i) => {
    const w = larguras[i]!;
    linhas.forEach((t, n) => {
      const tx = direita[i] ? x + w - RESPIRO - font.widthOfTextAtSize(t, TAMANHO) : x + RESPIRO;
      escrever(pagina, t, tx, y - RESPIRO - TAMANHO - n * ENTRELINHA, font, TAMANHO);
    });
    x += w;
  });
  pagina.drawLine({ start: { x: MARGEM, y: y - altura }, end: { x, y: y - altura }, thickness: 0.5, color: borda });
  return y - altura;
}

type Medida = Pick<PDFFont, 'widthOfTextAtSize'>;

/** O texto cortado na largura, terminando em "…" quando não cabe inteiro. */
function cortar(texto: string, largura: number, font: Medida, tamanho: number): string {
  if (font.widthOfTextAtSize(texto, tamanho) <= largura) return texto;
  let t = texto;
  while (t && font.widthOfTextAtSize(`${t}…`, tamanho) > largura) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Quebra o texto na largura, por palavra (palavra maior que a largura é partida, com pelo menos um
 * caractere por linha, mesmo numa coluna mais estreita que ele); no máximo maxLinhas, a última com "…".
 */
export function quebrar(texto: string, largura: number, font: Medida, maxLinhas = MAX_LINHAS_CELULA, tamanho = TAMANHO): string[] {
  const cabe = (t: string) => font.widthOfTextAtSize(t, tamanho) <= largura;
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of texto.split(' ')) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (cabe(tentativa)) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    let resto = palavra;
    while (resto && !cabe(resto)) {
      let n = resto.length - 1;
      while (n > 1 && !cabe(resto.slice(0, n))) n--;
      // n >= 1: o laço sempre avança, mesmo quando nem um caractere cabe.
      n = Math.max(1, n);
      linhas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    atual = resto;
  }
  if (atual || linhas.length === 0) linhas.push(atual);
  if (linhas.length <= maxLinhas) return linhas;
  const cortadas = linhas.slice(0, maxLinhas);
  cortadas[maxLinhas - 1] = cortar(`${cortadas[maxLinhas - 1]!}…`, largura, font, tamanho);
  return cortadas;
}
