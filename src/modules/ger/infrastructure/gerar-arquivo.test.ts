import { describe, expect, it } from 'vitest';
import { LIMITE_EXPORTACAO_ASSINCRONA, LIMITE_EXPORTACAO_PDF, LIMITE_EXPORTACAO_SINCRONA, tetoAssincrono, type PlanilhaExportacao } from './exportacao';
import { gerarArquivo } from './gerar-arquivo';

// O despachante por formato do C3 (US-024): cada formato no seu gerador e o teto próprio do PDF.
const planilha = (n: number, nome = 'Aba'): PlanilhaExportacao => ({
  nome,
  colunas: [{ titulo: 'A', tipo: 'texto' }],
  linhas: Array.from({ length: n }, () => ['x']),
});
const assinatura = (r: Awaited<ReturnType<typeof gerarArquivo>>) => (r.ok ? Buffer.from(r.valor.slice(0, 4)).toString('latin1') : r.erros.map((e) => e.mensagem).join(' '));

describe('gerarArquivo', () => {
  it('cada formato no seu gerador', async () => {
    expect(assinatura(await gerarArquivo('pdf', [planilha(1)]))).toBe('%PDF');
    expect(assinatura(await gerarArquivo('xlsx', [planilha(1)]))).toBe('PK\u0003\u0004');
    expect(assinatura(await gerarArquivo('csv', [planilha(1)]))).toBe('ï»¿"'); // BOM UTF-8
  });

  it('CSV com mais de uma aba: recusa', async () => {
    expect(assinatura(await gerarArquivo('csv', [planilha(1), planilha(1, 'Outra')]))).toBe('O CSV tem uma aba só.');
  });

  it(`PDF: até ${LIMITE_EXPORTACAO_SINCRONA} na hora e até ${LIMITE_EXPORTACAO_PDF} em segundo plano, mesmo com o limite assíncrono`, async () => {
    expect(assinatura(await gerarArquivo('pdf', [planilha(LIMITE_EXPORTACAO_SINCRONA + 1)]))).toMatch(/use a exportação assíncrona/);
    const acima = await gerarArquivo('pdf', [planilha(LIMITE_EXPORTACAO_PDF + 1)], { limite: LIMITE_EXPORTACAO_ASSINCRONA });
    expect(assinatura(acima)).toBe(`A exportação tem ${LIMITE_EXPORTACAO_PDF + 1} linhas; o máximo é ${LIMITE_EXPORTACAO_PDF}. Use filtros para reduzir.`);
  });

  it('teto assíncrono por formato', () => {
    expect(tetoAssincrono('pdf')).toBe(LIMITE_EXPORTACAO_PDF);
    expect(tetoAssincrono('xlsx')).toBe(LIMITE_EXPORTACAO_ASSINCRONA);
    expect(tetoAssincrono('csv')).toBe(LIMITE_EXPORTACAO_ASSINCRONA);
  });
});
