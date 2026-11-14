import { describe, expect, it } from 'vitest';
import { numerosForaDaMensagem } from './ia-desvio';

describe('numerosForaDaMensagem (D-P35-2: números das ferramentas, não da IA)', () => {
  const mensagem = 'Mar/26: orçado R$ 1.500,00; desvio R$ 150,00; uso 130,00%; conta 4.1.1.5.005.';
  it('aceita os números que estão na mensagem, como vieram', () => {
    expect(numerosForaDaMensagem('Em Mar/26 a conta 4.1.1.5.005 passou R$ 150,00 (130,00% de uso).', mensagem)).toEqual([]);
  });
  it('acusa número novo, número refeito e ano por extenso', () => {
    expect(numerosForaDaMensagem('Passou R$ 151,00, quase 1.500 reais, em 2026.', mensagem)).toEqual(['151,00', '2026']);
  });
});
