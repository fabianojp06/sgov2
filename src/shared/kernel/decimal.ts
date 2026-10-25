import Decimal from 'decimal.js';
import { ErroDominio } from './erros';

// Construtor isolado do decimal.js: Half-Even e precisão folgada para os cálculos
// intermediários, sem alterar a configuração global usada por outras bibliotecas.
export const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN, precision: 40 });
export type Dec = InstanceType<typeof D>;

const NUMERO = /^-?\d+(\.\d+)?$/;

// Converte a entrada aceita pelo núcleo (texto decimal ou Decimal) sem passar por number.
export function paraDec(v: string | Decimal, tipo: string): Dec {
  if (Decimal.isDecimal(v)) return new D(v.toString());
  if (typeof v !== 'string') {
    throw new TypeError(`${tipo} não aceita ${typeof v}: use texto decimal ou Decimal (spec §5)`);
  }
  if (!NUMERO.test(v)) throw new ErroDominio('VALOR_INVALIDO', `Valor inválido para ${tipo}: "${v}"`, { valor: v });
  return new D(v);
}

// Remove o sinal de -0 para que "-0.00" nunca apareça.
export function semZeroNegativo(v: Dec): Dec {
  return v.isZero() ? new D(0) : v;
}

// Formatação pt-BR a partir do texto exato (Intl aceita string decimal), nunca de um number calculado.
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
