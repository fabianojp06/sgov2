import { Dinheiro } from './dinheiro';

// Anual em 12 parcelas: 11 parcelas iguais (Half-Even) e a diferença em dezembro,
// para que a soma feche exatamente com o anual (critério de aceite da US-005).
export function distribuirEm12(anual: Dinheiro): readonly Dinheiro[] {
  const parcela = anual.dividir('12');
  const onze = Array.from({ length: 11 }, () => parcela);
  return [...onze, anual.subtrair(Dinheiro.somarTodos(onze))];
}
