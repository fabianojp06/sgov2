import { describe, expect, it } from 'vitest';
import { ehFormatoArquivo, origemDeExportacaoValida, respostaDeAgendamento, respostaDeArquivo, respostaDeErro, TIPOS_ARQUIVO } from './download';

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

  it('formato: só xlsx, csv e pdf (chave do próprio objeto)', () => {
    expect([ehFormatoArquivo('xlsx'), ehFormatoArquivo('csv'), ehFormatoArquivo('pdf'), ehFormatoArquivo('doc'), ehFormatoArquivo('toString'), ehFormatoArquivo(null)]).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
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

  it('agendamento: 303 para Minhas exportações, Location relativo e sem cache', () => {
    const r = respostaDeAgendamento('0b8f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f');
    expect(r.status).toBe(303);
    expect(r.headers.get('Location')).toBe('/rel/exportacoes?pedido=0b8f6c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
});
