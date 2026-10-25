import type Decimal from 'decimal.js';
import { comCasas, D, type Dec, formatarPtBr, paraDec, semZeroNegativo } from './decimal';
import { ErroDominio } from './erros';

// Dinheiro em NUMERIC(15,2), arredondado Half-Even em 2 casas (spec §5, D5).
const LIMITE = new D('9999999999999.99');

export class Dinheiro {
  private constructor(private readonly valor: Dec) {}

  static de(v: string | Decimal): Dinheiro {
    return Dinheiro.criar(paraDec(v, 'Dinheiro'));
  }

  static zero(): Dinheiro {
    return new Dinheiro(new D(0));
  }

  // O limite vale para o total: somas parciais podem passar dele sem erro.
  static somarTodos(xs: readonly Dinheiro[]): Dinheiro {
    return Dinheiro.criar(xs.reduce((total, x) => total.plus(x.valor), new D(0)));
  }

  private static criar(v: Dec): Dinheiro {
    const arredondado = semZeroNegativo(v.toDecimalPlaces(2, D.ROUND_HALF_EVEN));
    if (arredondado.abs().greaterThan(LIMITE)) {
      throw new ErroDominio('VALOR_FORA_DO_LIMITE', 'Valor fora do limite de NUMERIC(15,2)', {
        valor: comCasas(arredondado, 2),
      });
    }
    return new Dinheiro(arredondado);
  }

  somar(o: Dinheiro): Dinheiro {
    return Dinheiro.criar(this.valor.plus(o.valor));
  }

  subtrair(o: Dinheiro): Dinheiro {
    return Dinheiro.criar(this.valor.minus(o.valor));
  }

  multiplicar(f: string | Decimal): Dinheiro {
    return Dinheiro.criar(this.valor.times(paraDec(f, 'fator')));
  }

  dividir(d: string | Decimal): Dinheiro {
    const divisor = paraDec(d, 'divisor');
    if (divisor.isZero()) throw new ErroDominio('DIVISAO_POR_ZERO', 'Divisão de valor por zero');
    return Dinheiro.criar(this.valor.dividedBy(divisor));
  }

  negar(): Dinheiro {
    return Dinheiro.criar(this.valor.negated());
  }

  comparar(o: Dinheiro): -1 | 0 | 1 {
    return this.valor.comparedTo(o.valor) as -1 | 0 | 1;
  }

  ehZero(): boolean {
    return this.valor.isZero();
  }

  ehNegativo(): boolean {
    return this.valor.isNegative() && !this.valor.isZero();
  }

  paraString(): string {
    return comCasas(this.valor, 2);
  }

  formatar(): string {
    return formatarPtBr(this.paraString(), { style: 'currency', currency: 'BRL' });
  }

  // Cópia: o Decimal só é imutável por convenção (o array de dígitos pode ser alterado).
  paraDecimal(): Decimal {
    return new D(this.valor);
  }
}
