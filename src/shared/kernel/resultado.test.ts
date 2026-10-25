import { describe, expect, it } from 'vitest';
import { ErroDominio } from './erros';
import { falha, ok } from './resultado';

describe('Resultado e ErroDominio', () => {
  it('ok e falha', () => {
    expect(ok(1)).toEqual({ ok: true, valor: 1 });
    expect(falha([{ campo: 'valor', mensagem: 'obrigatório' }])).toEqual({
      ok: false,
      erros: [{ campo: 'valor', mensagem: 'obrigatório' }],
    });
  });

  it('ErroDominio guarda código e detalhes', () => {
    const e = new ErroDominio('VALOR_FORA_DO_LIMITE', 'Valor acima do limite', { valor: '1' });
    expect(e).toBeInstanceOf(Error);
    expect([e.codigo, e.message, e.detalhes, e.name]).toEqual([
      'VALOR_FORA_DO_LIMITE',
      'Valor acima do limite',
      { valor: '1' },
      'ErroDominio',
    ]);
  });
});
