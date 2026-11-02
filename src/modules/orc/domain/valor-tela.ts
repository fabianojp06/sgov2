import type { Dinheiro } from '@/shared/kernel';

// Valor digitado na tela no formato brasileiro ("1.234,56"): vira o texto canônico ("1234.56")
// que lerValor entende. Na tela, o ponto é sempre separador de milhar; o que não segue o formato
// fica como veio, e lerValor recusa com a mensagem de formato.
const FORMATO_BR = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/;

export function valorDaTela(texto: string): string {
  const t = texto.trim();
  if (!FORMATO_BR.test(t)) return t;
  return t.replace(/\./g, '').replace(',', '.');
}

// O contrário, para preencher o formulário: "1234.56" → "1.234,56".
export function valorParaTela(valor: Dinheiro): string {
  const [inteira = '0', decimal = '00'] = valor.paraString().replace('-', '').split('.');
  const comMilhar = inteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${valor.ehNegativo() ? '-' : ''}${comMilhar},${decimal}`;
}
