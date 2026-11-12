import Decimal from 'decimal.js';
import { ErroDominio } from './erros';

// Construtor isolado do decimal.js: Half-Even e precisão folgada para os cálculos
// intermediários, sem alterar a configuração global usada por outras bibliotecas.
export const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
export type Dec = InstanceType<typeof D>;

const NUMERO = /^-?\d+(\.\d+)?$/;
// Texto mais longo que isso não é valor monetário nem percentual: recusar antes de calcular
// evita que uma entrada de milhões de dígitos trave o servidor (divisão quadrática) ou vá
// inteira para o erro e para o log.
const TAMANHO_MAXIMO = 40;
// Decimal já construído: expoente até 10^40 e até 12 palavras de 7 dígitos (84 dígitos), folga
// sobre a precisão de 40 do clone D.
const EXPOENTE_MAXIMO = 40;
const PALAVRAS_MAXIMAS = 12;

// Converte a entrada aceita pelo núcleo (texto decimal ou Decimal) sem passar por number.
// Decimal passa pela mesma validação do texto (toFixed sem expoente): barra NaN, Infinity e
// objetos que só fingem ser Decimal.
export function paraDec(v: string | Decimal, tipo: string): Dec {
  if (Decimal.isDecimal(v)) {
    // O toFixed de um Decimal com expoente ou dígitos demais (1e5000000, 0,111… com milhões de casas)
    // montaria um texto enorme antes da validação: os dois são conferidos antes, que é barato. Acima
    // de 10^40 nenhum valor do núcleo cabe; abaixo de 10^-40 o valor é resíduo de conta e vale zero
    // (Dinheiro e Percentual arredondam para 2 ou 4 casas).
    const { e: expoente, d: digitos } = v as { e?: unknown; d?: unknown };
    if (typeof expoente === 'number' && expoente < -EXPOENTE_MAXIMO) return new D(0);
    if (typeof expoente !== 'number' || expoente > EXPOENTE_MAXIMO || (Array.isArray(digitos) && digitos.length > PALAVRAS_MAXIMAS)) {
      throw new ErroDominio('VALOR_INVALIDO', `Valor inválido para ${tipo}`);
    }
    const texto = typeof v.toFixed === 'function' ? v.toFixed() : '';
    if (!NUMERO.test(texto)) throw new ErroDominio('VALOR_INVALIDO', `Valor inválido para ${tipo}`);
    return new D(texto);
  }
  if (typeof v !== 'string') {
    throw new TypeError(`${tipo} não aceita ${typeof v}: use texto decimal ou Decimal (spec §5)`);
  }
  if (v.length > TAMANHO_MAXIMO) {
    throw new ErroDominio('VALOR_INVALIDO', `Valor inválido para ${tipo}: texto longo demais`, { tamanho: v.length });
  }
  // JSON.stringify escapa caracteres de controle: a mensagem não leva quebra de linha nem ESC ao log.
  if (!NUMERO.test(v)) throw new ErroDominio('VALOR_INVALIDO', `Valor inválido para ${tipo}: ${JSON.stringify(v)}`, { valor: v });
  return new D(v);
}

// Remove o sinal de -0 para que "-0.00" nunca apareça.
export function semZeroNegativo(v: Dec): Dec {
  return v.isZero() ? new D(0) : v;
}

// Formatação pt-BR a partir do texto exato (Intl aceita string decimal), nunca de um number calculado.
// Depende do NumberFormat v3 (Node ≥ 20; o engines exige ≥ 22.12), que lê a string sem passar por
// number: num runtime mais antigo, valores com mais de 15 dígitos perderiam precisão (#168).
export function formatarPtBr(texto: string, opcoes: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat('pt-BR', opcoes)
    .format(texto as unknown as number)
    .replace(/\u00a0/g, ' ');
}

// Texto com casas fixas. Único uso de toFixed do núcleo (o do Decimal, nunca o de number):
// a regra de lint que barra .toFixed abre exceção só para este arquivo.
export function comCasas(v: Dec, casas: number): string {
  return v.toFixed(casas);
}
