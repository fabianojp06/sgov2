import { Dinheiro } from '@/shared/kernel';

// Valor digitado na tela no formato brasileiro ("1.234,56"): vira o texto canônico ("1234.56")
// que lerValor entende. Na tela, o ponto é sempre separador de milhar: "1.00" ou "1.5" não viram
// decimal em silêncio. O que não segue o formato e tem ponto ou vírgula volta marcado como
// inválido, e lerValor recusa com a mensagem de formato.
export const VALOR_INVALIDO = '(formato inválido)';
const FORMATO_BR = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/;

export function valorDaTela(texto: string): string {
  const t = texto.trim();
  if (!FORMATO_BR.test(t)) return /[.,]/.test(t) ? VALOR_INVALIDO : t;
  return t.replace(/\./g, '').replace(',', '.');
}

// O contrário, para preencher o formulário: "1234.56" → "1.234,56".
export function valorParaTela(valor: Dinheiro): string {
  const [inteira = '0', decimal = '00'] = valor.paraString().replace('-', '').split('.');
  const comMilhar = inteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${valor.ehNegativo() ? '-' : ''}${comMilhar},${decimal}`;
}

/** Valor da tela ("1.234,56") ou canônico ("1234.56"); nulo se fora do formato, com mais de 2 casas ou do limite. */
export function lerValorDigitado(v: string): Dinheiro | null {
  const canonico = valorDaTela(v);
  if (canonico === VALOR_INVALIDO || !/^-?\d+(\.\d{1,2})?$/.test(canonico)) return null;
  try {
    return Dinheiro.de(canonico);
  } catch {
    return null; // fora do limite de NUMERIC(15,2)
  }
}
