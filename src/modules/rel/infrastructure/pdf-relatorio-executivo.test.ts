import { describe, expect, it } from 'vitest';
import { gerarPdfRelatorio, nomeArquivoRelatorio, paraWinAnsi, quebrarLinhas, tituloRelatorio } from './pdf-relatorio-executivo';

describe('PDF do relatório executivo (US-103)', () => {
  it('troca o que a Helvetica padrão não codifica por "?" e mantém acentos e sinais tipográficos', () => {
    expect(paraWinAnsi('Ação – “ok” 🚀 ≥ €')).toBe('Ação – “ok” ? ? €');
    expect(paraWinAnsi('linha 1\nlinha 2')).toBe('linha 1 linha 2');
  });

  it('quebra por palavra e corta palavra maior que a linha; tab e espaços Unicode separam palavras', () => {
    const medir = (t: string) => t.length;
    expect(quebrarLinhas('um dois três quatro', 9, medir)).toEqual(['um dois', 'três', 'quatro']);
    expect(quebrarLinhas('abcdefghijkl', 5, medir)).toEqual(['abcde', 'fghij', 'kl']);
    expect(quebrarLinhas('a\tb\u2003c', 99, medir)).toEqual(['a b c']);
  });

  it('revisão 12.12: palavra enorme não prende a CPU (corte por busca binária)', () => {
    let medidas = 0;
    const medir = (t: string) => (medidas++, t.length * 7);
    const linhas = quebrarLinhas('W'.repeat(5000), 500, medir);
    expect(linhas.join('')).toHaveLength(5000);
    expect(medidas).toBeLessThan(2000);
  });

  it('gera um PDF válido com rascunho, gráficos, muitos TPs e texto longo com emoji', async () => {
    const tps = Array.from({ length: 30 }, (_, i) => ({ numero: `TP-${i}`, oficial: i % 2 === 0, valorGlobal: `${(i + 1) * 1000}.00`, execucao: i ? '0.00' : null }));
    const bytes = await gerarPdfRelatorio(
      {
        mes: '2027-05',
        admCentral: { ano: 2027, situacao: 'Oficializado', orcamentoAno: '1000000.00', pessoal: '600000.00', percentualPessoal: '60.00', empregadosDezembro: 40, tetoEfetivo: '1200000.00', usoDoTeto: '83.33', resultadoAno: '-5000.00', saldo: '200000.00' },
        tps,
        tpsOmitidos: 2,
      },
      { resumo: 'Resumo longo 🚀 '.repeat(200), riscos: ['Risco único.'], recomendacoes: [] },
      { titulo: tituloRelatorio('2027-05'), situacao: 'RASCUNHO', aprovacao: null, emitidoPor: 'gfin', posicao: 'Indicadores na posição de 20/05/2027' },
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(nomeArquivoRelatorio('2027-05', 'RASCUNHO')).toBe('relatorio-executivo-2027-05-rascunho.pdf');
    expect(nomeArquivoRelatorio('2027-05', 'APROVADO')).toBe('relatorio-executivo-2027-05.pdf');
  });
});
