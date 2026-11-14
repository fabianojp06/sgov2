import { describe, expect, it } from 'vitest';
import { MAXIMO_TOPICO } from '../domain/apresentacao';
import { gerarPdfApresentacao, linhasComReticencias } from './pdf-apresentacao';

describe('slides da apresentação em PDF (US-105)', () => {
  it('corte com reticências, nunca calado; o tópico máximo cabe inteiro na coluna com gráfico (Helvetica 13 pt, 5 linhas)', async () => {
    const medir = (s: string) => s.length;
    expect(linhasComReticencias('um dois três quatro cinco', 9, medir, 2)).toEqual(['um dois', 'três…']);
    expect(linhasComReticencias('um dois', 9, medir, 2)).toEqual(['um dois']);
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const fonte = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    // Um tópico realista de 200 caracteres cabe inteiro na coluna de (960 − 80) × 0,45 − 18 pt; o caso extremo
    // (só letras largas) passa de 5 linhas e termina com "…", nunca cortado calado.
    const largura = (960 - 80) * 0.45 - 18;
    const medir13 = (s: string) => fonte.widthOfTextAtSize(s, 13);
    const realista = 'O orçamento da Administração Central para 2027 ficou em R$ 1.234.567,89, dentro do teto, com saldo de R$ 98.765,43 e resultado positivo. '.repeat(2).slice(0, MAXIMO_TOPICO);
    expect(linhasComReticencias(realista, largura, medir13, 99).length).toBeLessThanOrEqual(5);
    const extremo = linhasComReticencias('WWWW '.repeat(MAXIMO_TOPICO / 5).trim(), largura, medir13, 5);
    expect(extremo).toHaveLength(5);
    expect(extremo[4]!.endsWith('…')).toBe(true);
  });

  it('gera um PDF válido com capa, gráficos do sistema, tópicos longos e emoji', async () => {
    const bytes = await gerarPdfApresentacao(
      'Orçamento 2027 da Administração Central 🚀',
      {
        slides: [
          { titulo: 'Visão geral', topicos: ['Tópico '.repeat(60), 'Outro'], grafico: 'ORCAMENTO_TETO', notas: 'Notas '.repeat(100) },
          { titulo: 'TPs', topicos: [], grafico: 'VALOR_GLOBAL_TPS', notas: '' },
        ],
      },
      {
        mes: '2027-05',
        admCentral: { ano: 2027, situacao: 'Oficializado', orcamentoAno: '1000.00', pessoal: '600.00', percentualPessoal: '60.00', empregadosDezembro: 4, tetoEfetivo: '1200.00', usoDoTeto: '83.33', resultadoAno: '0.00', saldo: '200.00' },
        tps: Array.from({ length: 14 }, (_, i) => ({ numero: `TP-${i}`, oficial: i % 2 === 0, valorGlobal: i === 3 ? null : `${(i + 1) * 100}.00`, execucao: null })),
        tpsOmitidos: 0,
      },
      'gfin',
      '14/11/2026 às 09:00',
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
