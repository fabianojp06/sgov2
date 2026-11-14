import type { PDFFont, PDFPage } from 'pdf-lib';
import { Dinheiro } from '@/shared/kernel';
import type { DadosRelatorio, TextosRelatorio } from '../domain/relatorio-executivo';

// PDF do relatório executivo mensal (US-103, IA-14): A4 retrato, Helvetica (fontes padrão do PDF, nada lido
// do disco), com os indicadores, os gráficos desenhados pelo sistema (barras, nunca pela IA) e os textos.
// O rascunho leva "RASCUNHO – não distribuir" em todas as páginas; o aprovado, quem aprovou e quando.
// Texto fora do WinAnsi (o que a Helvetica padrão codifica) vira "?" antes de desenhar.

const LARGURA = 595.28;
const ALTURA = 841.89;
const MARGEM = 48;
const TAMANHO = 10;
const ENTRELINHA = 14;
const MAX_BARRAS = 15;

export type CabecalhoPdf = { titulo: string; situacao: 'RASCUNHO' | 'APROVADO'; aprovacao: string | null; emitidoPor: string; posicao: string };

// WinAnsi (cp1252): o Latin-1 imprimível e os sinais tipográficos comuns.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function paraWinAnsi(texto: string): string {
  // Tab, quebra e espaços Unicode viram espaço (o espaço não separável, do WinAnsi, fica).
  return [...texto.replace(/[\t\r\n\v\f\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' ')]
    .map((c) => {
      const n = c.codePointAt(0)!;
      return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WIN_ANSI_EXTRA.has(c) ? c : '?';
    })
    .join('');
}

/**
 * Quebra o texto em linhas que cabem na largura (por palavra; palavra maior que a linha é cortada). O corte
 * da palavra longa é por busca binária: medir prefixo a prefixo prendia a CPU (revisão 12.12 do #519).
 */
export function quebrarLinhas(texto: string, largura: number, medir: (t: string) => number): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of paraWinAnsi(texto).split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (medir(tentativa) <= largura) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    let resto = palavra;
    while (medir(resto) > largura && resto.length > 1) {
      // Maior prefixo que cabe (pelo menos 1 caractere).
      let [cabe, nao] = [1, resto.length];
      while (nao - cabe > 1) {
        const meio = (cabe + nao) >> 1;
        if (medir(resto.slice(0, meio)) <= largura) cabe = meio;
        else nao = meio;
      }
      linhas.push(resto.slice(0, cabe));
      resto = resto.slice(cabe);
    }
    atual = resto;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

const moeda = (v: string | null) => (v === null ? '—' : Dinheiro.de(v).formatar());
const pct = (v: string | null) => (v === null ? '—' : `${v.replace('.', ',')}%`);
const mesTexto = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

export async function gerarPdfRelatorio(dados: DadosRelatorio, textos: TextosRelatorio, cab: CabecalhoPdf): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, grayscale, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(paraWinAnsi(cab.titulo));
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const util = LARGURA - 2 * MARGEM;
  let pagina: PDFPage = doc.addPage([LARGURA, ALTURA]);
  let y = ALTURA - MARGEM;

  const rodape = (p: PDFPage) => {
    const marca = cab.situacao === 'RASCUNHO' ? 'RASCUNHO - não distribuir' : (cab.aprovacao ?? '');
    p.drawText(paraWinAnsi(`${marca} · ${cab.posicao} · Emitido por ${cab.emitidoPor}`), { x: MARGEM, y: MARGEM / 2, size: 7, font: fonte, color: grayscale(0.35) });
    // Rascunho: marca d'água grande e diagonal em toda página, além do rodapé.
    if (cab.situacao === 'RASCUNHO') {
      p.drawText('RASCUNHO', { x: LARGURA / 2 - 190, y: ALTURA / 2 - 90, size: 80, font: negrito, color: grayscale(0.85), rotate: degrees(35), opacity: 0.5 });
    }
  };
  const novaPagina = () => {
    rodape(pagina);
    pagina = doc.addPage([LARGURA, ALTURA]);
    y = ALTURA - MARGEM;
  };
  const garantir = (altura: number) => {
    if (y - altura < MARGEM) novaPagina();
  };
  const escrever = (texto: string, f: PDFFont = fonte, tamanho = TAMANHO, recuo = 0) => {
    for (const linha of quebrarLinhas(texto, util - recuo, (t) => f.widthOfTextAtSize(t, tamanho))) {
      garantir(ENTRELINHA);
      pagina.drawText(linha, { x: MARGEM + recuo, y, size: tamanho, font: f });
      y -= ENTRELINHA;
    }
  };
  const titulo = (texto: string) => {
    garantir(ENTRELINHA * 3);
    y -= ENTRELINHA / 2;
    escrever(texto, negrito, 12);
  };
  const lista = (itens: readonly string[]) => {
    if (itens.length === 0) escrever('Nenhum.');
    for (const i of itens) {
      const linhas = quebrarLinhas(i, util - 14, (t) => fonte.widthOfTextAtSize(t, TAMANHO));
      linhas.forEach((l, n) => {
        garantir(ENTRELINHA);
        if (n === 0) pagina.drawText('-', { x: MARGEM, y, size: TAMANHO, font: fonte });
        pagina.drawText(l, { x: MARGEM + 14, y, size: TAMANHO, font: fonte });
        y -= ENTRELINHA;
      });
    }
  };
  // Barras horizontais: rótulo à esquerda, barra proporcional ao maior valor e o valor à direita.
  const barras = (itens: readonly { rotulo: string; valor: Dinheiro }[]) => {
    const maior = itens.reduce((m, i) => (i.valor.comparar(m) > 0 ? i.valor : m), Dinheiro.zero());
    const larguraRotulo = 110;
    const larguraValor = 110;
    const larguraBarra = util - larguraRotulo - larguraValor - 8;
    for (const i of itens) {
      garantir(ENTRELINHA + 2);
      pagina.drawText(quebrarLinhas(i.rotulo, larguraRotulo - 4, (x) => fonte.widthOfTextAtSize(x, 9))[0] ?? '', { x: MARGEM, y, size: 9, font: fonte });
      const fracao = maior.ehZero() ? 0 : Math.max(0, Math.min(1, Number(i.valor.paraString()) / Number(maior.paraString())));
      if (fracao > 0) pagina.drawRectangle({ x: MARGEM + larguraRotulo, y: y - 2, width: larguraBarra * fracao, height: 10, color: rgb(0.25, 0.45, 0.7) });
      pagina.drawText(paraWinAnsi(i.valor.formatar()), { x: MARGEM + larguraRotulo + larguraBarra + 8, y, size: 9, font: fonte });
      y -= ENTRELINHA + 2;
    }
  };

  escrever(cab.titulo, negrito, 16);
  y -= 4;
  escrever(cab.situacao === 'RASCUNHO' ? 'RASCUNHO - não distribuir. Textos gerados com IA, em revisão.' : `Aprovado: ${cab.aprovacao ?? ''}. Textos gerados com IA e revisados.`, negrito, 9);
  escrever(cab.posicao, fonte, 9);

  titulo('Resumo');
  escrever(textos.resumo);

  const a = dados.admCentral;
  if (a) {
    titulo(`Administração Central - exercício ${a.ano} (${a.situacao})`);
    escrever(`Orçamento do ano: ${moeda(a.orcamentoAno)} · Pessoal: ${moeda(a.pessoal)} (${pct(a.percentualPessoal)}) · Empregados em dezembro: ${a.empregadosDezembro}`);
    if (a.tetoEfetivo !== null) {
      escrever(`Teto: ${moeda(a.tetoEfetivo)} · Uso do teto: ${pct(a.usoDoTeto)} · Saldo: ${moeda(a.saldo)} · Resultado do ano: ${moeda(a.resultadoAno)}`);
      y -= 4;
      barras([
        { rotulo: 'Orçamento', valor: Dinheiro.de(a.orcamentoAno) },
        { rotulo: 'Teto', valor: Dinheiro.de(a.tetoEfetivo) },
      ]);
    }
  }

  if (dados.tps && dados.tps.length > 0) {
    titulo('Termos de Parceria - Valor Global');
    // TP sem Valor Global fica fora do gráfico (não vira zero).
    const comValor = dados.tps.filter((t): t is typeof t & { valorGlobal: string } => t.valorGlobal !== null);
    const ordenados = [...comValor].sort((x, z) => Dinheiro.de(z.valorGlobal).comparar(Dinheiro.de(x.valorGlobal)));
    barras(ordenados.slice(0, MAX_BARRAS).map((t) => ({ rotulo: `${t.numero}${t.oficial ? '' : ' (não oficial)'}`, valor: Dinheiro.de(t.valorGlobal) })));
    const fora = dados.tps.length - Math.min(ordenados.length, MAX_BARRAS) + dados.tpsOmitidos;
    if (fora > 0) escrever(`Mais ${fora} TP(s) fora do gráfico.`, fonte, 8);
    escrever(`Execução: ${dados.tps.map((t) => `${t.numero} ${pct(t.execucao)}`).join(' · ')}`, fonte, 9);
  }

  titulo('Riscos');
  lista(textos.riscos);
  titulo('Recomendações');
  lista(textos.recomendacoes);
  rodape(pagina);
  return doc.save();
}

export const nomeArquivoRelatorio = (mes: string, situacao: 'RASCUNHO' | 'APROVADO') =>
  `relatorio-executivo-${mes}${situacao === 'RASCUNHO' ? '-rascunho' : ''}.pdf`;
export const tituloRelatorio = (mes: string) => `Relatório executivo - ${mesTexto(mes)}`;
