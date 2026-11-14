import { describe, expect, it } from 'vitest';
import { numerosForaDosFatos } from './ia-desvio';

// D-P35-2 (revisão 12.12): números das ferramentas, não da IA. Os casos de ataque da revisão.
describe('numerosForaDosFatos', () => {
  const fatos = { numeros: new Set(['150,00', '-350,00', '350,00', '89,48', '2.500,00', '4.1.1.5.005', '01', '2026']), meses: new Set(['Mar/26', 'Fev/26']) };

  it('aceita os números e os meses dos fatos, inteiros, inclusive o valor sem o sinal', () => {
    expect(numerosForaDosFatos('Em Mar/26 a conta 4.1.1.5.005 passou R$ 150,00 (89,48% de uso) e compensou R$ 350,00 em Fev/26.', fatos)).toEqual([]);
  });

  it('acusa o pedaço de um número dos fatos, o mês fora dos fatos, o percentual refeito e o número curto', () => {
    expect(numerosForaDosFatos('O desvio foi de R$ 50,00 em Dez/26.', fatos)).toEqual(['Dez/26', '50,00']);
    expect(numerosForaDosFatos('uso de 9,48% em 3 meses', fatos)).toEqual(['9,48', '3']);
    expect(numerosForaDosFatos('R$ 2.500 a mais', fatos)).toEqual(['2.500']);
  });
});
