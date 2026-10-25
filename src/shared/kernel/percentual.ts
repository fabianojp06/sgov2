import type Decimal from 'decimal.js';
import { comCasas, D, type Dec, formatarPtBr, paraDec, semZeroNegativo } from './decimal';
import type { Dinheiro } from './dinheiro';
import { ErroDominio } from './erros';

// Percentual em pontos ("51" = 51%), NUMERIC(9,4), Half-Even (spec §5).
const LIMITE = new D('99999.9999');
export class Percentual {
  private constructor(
    private readonly pontos: Dec,
    private readonly casas: number,
  ) {}

  static dePontos(v: string | Decimal): Percentual {
    const pontos = semZeroNegativo(paraDec(v, 'Percentual').toDecimalPlaces(4, D.ROUND_HALF_EVEN));
    if (pontos.abs().greaterThan(LIMITE)) {
      throw new ErroDominio('VALOR_FORA_DO_LIMITE', 'Percentual fora do limite de NUMERIC(9,4)', {
        valor: comCasas(pontos, 4),
      });
    }
    return new Percentual(pontos, 4);
  }

  // Realizado ÷ orçado em pontos com 2 casas (RN_OXR_010); sem orçamento, null (RN_OXR_012).
  // É indicador calculado, não parâmetro gravado: não tem o limite de NUMERIC(9,4)
  // (orçado de centavos com realizado alto dá razões enormes, e o relatório precisa mostrá-las).
  static razao(num: Dinheiro, den: Dinheiro): Percentual | null {
    if (den.ehZero()) return null;
    const pontos = new D(num.paraString()).dividedBy(den.paraString()).times(100);
    return new Percentual(semZeroNegativo(pontos.toDecimalPlaces(2, D.ROUND_HALF_EVEN)), 2);
  }

  comoFracao(): Decimal {
    return this.pontos.dividedBy(100);
  }

  paraString(): string {
    return comCasas(this.pontos, this.casas);
  }

  formatar(): string {
    const texto = formatarPtBr(comCasas(this.pontos, this.casas), {
      minimumFractionDigits: 2,
      maximumFractionDigits: this.casas,
    });
    return `${texto}%`;
  }
}
