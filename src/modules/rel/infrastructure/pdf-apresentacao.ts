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

export async function gerarPdfApresentacao(tema: string, roteiro: Roteiro, dados: DadosRelatorio, emitidoPor: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, grayscale } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(paraWinAnsi(`Apresentação - ${tema}`).slice(0, 120));
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const total = roteiro.slides.length + 1;

  const texto = (p: PDFPage, t: string, x: number, y: number, largura: number, f: PDFFont, tamanho: number, maxLinhas: number): number => {
    const linhas = quebrarLinhas(t, largura, (s) => f.widthOfTextAtSize(s, tamanho)).slice(0, maxLinhas);
    linhas.forEach((l, i) => p.drawText(l, { x, y: y - i * tamanho * 1.3, size: tamanho, font: f }));
    return y - linhas.length * tamanho * 1.3;
  };
  const rodape = (p: PDFPage, n: number) =>
    p.drawText(paraWinAnsi(`Gerado com IA a partir dos dados do sistema - revisar · ${emitidoPor} · ${n}/${total}`), { x: MARGEM, y: 16, size: 8, font: fonte, color: grayscale(0.4) });

  const barras = (p: PDFPage, itens: readonly { rotulo: string; valor: Dinheiro }[], x: number, yTopo: number, largura: number) => {
    const maior = itens.reduce((m, i) => (i.valor.comparar(m) > 0 ? i.valor : m), Dinheiro.zero());
    const larguraRotulo = 120;
    const larguraValor = 120;
    const larguraBarra = largura - larguraRotulo - larguraValor - 8;
    itens.slice(0, MAX_BARRAS).forEach((i, n) => {
      const y = yTopo - n * 22;
      p.drawText(quebrarLinhas(i.rotulo, larguraRotulo - 4, (s) => fonte.widthOfTextAtSize(s, 10))[0] ?? '', { x, y, size: 10, font: fonte });
      // Só a proporção geométrica da barra; os valores escritos vêm do Dinheiro.
      const fracao = maior.ehZero() ? 0 : Math.max(0, Math.min(1, Number(i.valor.paraString()) / Number(maior.paraString())));
      if (fracao > 0) p.drawRectangle({ x: x + larguraRotulo, y: y - 3, width: larguraBarra * fracao, height: 14, color: rgb(0.25, 0.45, 0.7) });
      p.drawText(paraWinAnsi(i.valor.formatar()), { x: x + larguraRotulo + larguraBarra + 8, y, size: 10, font: fonte });
    });
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
        .map((t) => ({ rotulo: `${t.numero}${t.oficial ? '' : ' (não oficial)'}`, valor: Dinheiro.de(t.valorGlobal) }))
        .sort((a, b) => b.valor.comparar(a.valor));
    return [];
  };

  const capa = doc.addPage([LARGURA, ALTURA]);
  texto(capa, tema, MARGEM, ALTURA / 2 + 40, LARGURA - 2 * MARGEM, negrito, 28, 3);
  texto(capa, `Reunião de diretoria · dados do sistema · ${dados.mes.slice(5, 7)}/${dados.mes.slice(0, 4)}`, MARGEM, ALTURA / 2 - 60, LARGURA - 2 * MARGEM, fonte, 14, 1);
  rodape(capa, 1);

  roteiro.slides.forEach((s, n) => {
    const p = doc.addPage([LARGURA, ALTURA]);
    let y = texto(p, s.titulo, MARGEM, ALTURA - MARGEM - 10, LARGURA - 2 * MARGEM, negrito, 24, 2) - 10;
    const itens = dadosDoGrafico(s.grafico);
    const larguraTopicos = itens.length > 0 ? (LARGURA - 2 * MARGEM) * 0.45 : LARGURA - 2 * MARGEM;
    for (const t of s.topicos) {
      p.drawText('-', { x: MARGEM, y, size: 16, font: fonte });
      y = texto(p, t, MARGEM + 18, y, larguraTopicos - 18, fonte, 16, 3) - 8;
    }
    if (itens.length > 0) barras(p, itens, MARGEM + (LARGURA - 2 * MARGEM) * 0.5, ALTURA - MARGEM - 90, (LARGURA - 2 * MARGEM) * 0.5);
    if (s.notas) texto(p, `Notas: ${s.notas}`, MARGEM, 60, LARGURA - 2 * MARGEM, fonte, 9, 3);
    rodape(p, n + 2);
  });
  return doc.save();
}
