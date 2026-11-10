import { describe, expect, it } from 'vitest';
import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeArquivo, respostaDeErro, TIPOS_ARQUIVO } from './download';

// Download das exportações (US-024): origem, formato e a resposta.
const pedido = (site?: string) => new Request('http://127.0.0.1:3200/x', site ? { headers: { 'sec-fetch-site': site } } : {});

describe('download das exportações', () => {
  it('origem: o próprio sistema, o endereço digitado ou sem o cabeçalho; outro site, não', () => {
    expect(origemDeExportacaoValida(pedido('same-origin'))).toBe(true);
    expect(origemDeExportacaoValida(pedido('none'))).toBe(true);
    expect(origemDeExportacaoValida(pedido())).toBe(true);
    expect(origemDeExportacaoValida(pedido('cross-site'))).toBe(false);
    expect(origemDeExportacaoValida(pedido('same-site'))).toBe(false);
  });

  it('formato: só xlsx e csv', () => {
    expect([ehFormatoArquivo('xlsx'), ehFormatoArquivo('csv'), ehFormatoArquivo('pdf'), ehFormatoArquivo(null)]).toEqual([true, true, false, false]);
  });

  it('resposta: anexo com o nome, o tipo e sem cache; nome fora do padrão é recusado', async () => {
    const r = respostaDeArquivo('plano-de-contas.csv', 'csv', new Uint8Array([65, 66]));
    expect(r.headers.get('content-type')).toBe(TIPOS_ARQUIVO.csv);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="plano-de-contas.csv"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([65, 66]));
    expect(() => respostaDeArquivo('a"b.csv', 'csv', new Uint8Array())).toThrow();
    expect(() => respostaDeArquivo('a\r\nX-Injetado: 1.csv', 'csv', new Uint8Array())).toThrow();
  });

  it('erro: JSON com o campo e o status', async () => {
    const r = respostaDeErro(403, '_', 'Recusado.');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erros: [{ campo: '_', mensagem: 'Recusado.' }] });
  });
});
