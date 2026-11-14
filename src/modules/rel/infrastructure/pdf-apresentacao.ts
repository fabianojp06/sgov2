import type { PDFFont, PDFPage } from 'pdf-lib';
import { Dinheiro } from '@/shared/kernel';
import type { Roteiro } from '../domain/apresentacao';
import type { DadosRelatorio } from '../domain/relatorio-executivo';
import { paraWinAnsi, quebrarLinhas } from './pdf-relatorio-executivo';

// Slides da apresentação (US-105, IA-15) em PDF 16:9 (960 × 540 pt), Helvetica padrão: capa, um slide por
// item do roteiro (título, tópicos e, se houver, o gráfico do SISTEMA com os dados lidos no servidor) e as
// notas do apresentador no rodapé, em letra pequena. Os gráficos são barras desenhadas aqui, nunca pela IA.

const LARGURA = 960;
const ALTURA = 540;
const MARGEM = 40;
const MAX_BARRAS = 10;

/** Linhas que cabem, com "…" no fim da última quando o texto foi cortado (revisão 12.12: nunca cortar calado). */
export function linhasComReticencias(t: string, largura: number, medir: (s: string) => number, maxLinhas: number): string[] {
  const linhas = quebrarLinhas(t, largura, medir);
  if (linhas.length <= maxLinhas) return linhas;
  const visiveis = linhas.slice(0, maxLinhas);
  let ultima = visiveis[maxLinhas - 1]!;
  while (ultima.length > 0 && medir(`${ultima}…`) > largura) ultima = ultima.slice(0, -1);
  visiveis[maxLinhas - 1] = `${ultima.trimEnd()}…`;
  return visiveis;
}

export async function gerarPdfApresentacao(tema: string, roteiro: Roteiro, dados: DadosRelatorio, emitidoPor: string, lidoEm: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, grayscale } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(paraWinAnsi(`Apresentação - ${tema}`).slice(0, 120));
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const total = roteiro.slides.length + 1;

  const texto = (p: PDFPage, t: string, x: number, y: number, largura: number, f: PDFFont, tamanho: number, maxLinhas: number): number => {
    const linhas = linhasComReticencias(t, largura, (s) => f.widthOfTextAtSize(s, tamanho), maxLinhas);
    linhas.forEach((l, i) => p.drawText(l, { x, y: y - i * tamanho * 1.3, size: tamanho, font: f }));
    return y - linhas.length * tamanho * 1.3;
  };
  // O roteiro volta do navegador: o rodapé diz de quem é a responsabilidade (revisão 12.12), não "dados do sistema".
  const rotulo = [...emitidoPor].slice(0, 60).join('');
  const rodape = (p: PDFPage, n: number) =>
    p.drawText(paraWinAnsi(`Roteiro com apoio de IA, de responsabilidade de ${rotulo} - revisar · gráficos do sistema · ${n}/${total}`), {
      x: MARGEM,
      y: 16,
      size: 8,
      font: fonte,
      color: grayscale(0.4),
    });

  const barras = (p: PDFPage, itens: readonly { rotulo: string; valor: Dinheiro }[], x: number, yTopo: number, largura: number, extra?: number) => {
    const maior = itens.reduce((m, i) => (i.valor.comparar(m) > 0 ? i.valor : m), Dinheiro.zero());
    const larguraRotulo = 120;
    const larguraValor = 120;
    const larguraBarra = largura - larguraRotulo - larguraValor - 8;
    const mostrados = itens.slice(0, MAX_BARRAS);
    mostrados.forEach((i, n) => {
      const y = yTopo - n * 22;
      // Corta o número, nunca o "*" de não oficial.
      const marca = i.rotulo.endsWith('*') ? '*' : '';
      const base = marca ? i.rotulo.slice(0, -1) : i.rotulo;
      const nome = linhasComReticencias(base, larguraRotulo - 12, (s) => fonte.widthOfTextAtSize(s, 10), 1)[0] ?? '';
      p.drawText(`${nome}${marca}`, { x, y, size: 10, font: fonte });
      // Só a proporção geométrica da barra; os valores escritos vêm do Dinheiro.
      const fracao = maior.ehZero() ? 0 : Math.max(0, Math.min(1, Number(i.valor.paraString()) / Number(maior.paraString())));
      if (fracao > 0) p.drawRectangle({ x: x + larguraRotulo, y: y - 3, width: larguraBarra * fracao, height: 14, color: rgb(0.25, 0.45, 0.7) });
      p.drawText(paraWinAnsi(i.valor.formatar()), { x: x + larguraRotulo + larguraBarra + 8, y, size: 10, font: fonte });
    });
    const fora = itens.length - mostrados.length + (extra ?? 0);
    const legendas = [itens.some((i) => i.rotulo.endsWith('*')) ? '* versão não oficial' : '', fora > 0 ? `+${fora} TP(s) não mostrados` : ''].filter(Boolean);
    if (legendas.length > 0) p.drawText(paraWinAnsi(legendas.join(' · ')), { x, y: yTopo - mostrados.length * 22 - 6, size: 9, font: fonte, color: grayscale(0.35) });
  };
  const dadosDoGrafico = (g: string): { rotulo: string; valor: Dinheiro }[] => {
    if (g === 'ORCAMENTO_TETO' && dados.admCentral?.tetoEfetivo)
      return [
        { rotulo: 'Orçamento', valor: Dinheiro.de(dados.admCentral.orcamentoAno) },
        { rotulo: 'Teto', valor: Dinheiro.de(dados.admCentral.tetoEfetivo) },
      ];
    if (g === 'VALOR_GLOBAL_TPS' && dados.tps)
      return dados.tps
        .filter((t): t is typeof t & { valorGlobal: string } => t.valorGlobal !== null)
        .map((t) => ({ rotulo: `${t.numero}${t.oficial ? '' : '*'}`, valor: Dinheiro.de(t.valorGlobal) }))
        .sort((a, b) => b.valor.comparar(a.valor));
    return [];
  };

  const semValor = dados.tps?.filter((t) => t.valorGlobal === null).length ?? 0;
  const capa = doc.addPage([LARGURA, ALTURA]);
  texto(capa, tema, MARGEM, ALTURA / 2 + 80, LARGURA - 2 * MARGEM, negrito, 24, 5);
  texto(capa, `Reunião de diretoria · dados do sistema lidos em ${lidoEm}`, MARGEM, ALTURA / 2 - 80, LARGURA - 2 * MARGEM, fonte, 14, 1);
  rodape(capa, 1);

  roteiro.slides.forEach((s, n) => {
    const p = doc.addPage([LARGURA, ALTURA]);
    let y = texto(p, s.titulo, MARGEM, ALTURA - MARGEM - 10, LARGURA - 2 * MARGEM, negrito, 24, 2) - 10;
    const itens = dadosDoGrafico(s.grafico);
    const comGrafico = itens.length > 0;
    const larguraTopicos = comGrafico ? (LARGURA - 2 * MARGEM) * 0.45 : LARGURA - 2 * MARGEM;
    // Com gráfico a coluna é estreita: letra menor e mais linhas, para o tópico máximo caber inteiro.
    const tamanho = comGrafico ? 13 : 16;
    for (const t of s.topicos) {
      p.drawText('-', { x: MARGEM, y, size: tamanho, font: fonte });
      y = texto(p, t, MARGEM + 18, y, larguraTopicos - 18, fonte, tamanho, comGrafico ? 5 : 3) - 6;
    }
    if (comGrafico) barras(p, itens, MARGEM + (LARGURA - 2 * MARGEM) * 0.5, ALTURA - MARGEM - 90, (LARGURA - 2 * MARGEM) * 0.5, s.grafico === 'VALOR_GLOBAL_TPS' ? semValor + dados.tpsOmitidos : 0);
    if (s.notas) texto(p, `Notas: ${s.notas}`, MARGEM, 60, LARGURA - 2 * MARGEM, fonte, 9, 3);
    rodape(p, n + 2);
  });
  return doc.save();
}
