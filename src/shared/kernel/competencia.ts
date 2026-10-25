import { ErroDominio } from './erros';

// Competência mensal no formato Mmm/AA (RN0302).
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
const FORMATO = /^([A-Za-z]{3})\/(\d{2})$/;

export class Competencia {
  private constructor(
    readonly ano: number,
    readonly mes: number,
  ) {}

  static de(ano: number, mes: number): Competencia {
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
      throw new ErroDominio('COMPETENCIA_INVALIDA', `Ano inválido: ${ano}`, { ano });
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new ErroDominio('COMPETENCIA_INVALIDA', `Mês inválido: ${mes}`, { mes });
    }
    return new Competencia(ano, mes);
  }

  static parse(s: string): Competencia {
    if (s.length > 6) {
      throw new ErroDominio('COMPETENCIA_INVALIDA', 'Competência inválida (use Mmm/AA, ex.: Jun/22)', {
        tamanho: s.length,
      });
    }
    const partes = FORMATO.exec(s);
    const indice = partes ? MESES.findIndex((m) => m.toLowerCase() === partes[1]!.toLowerCase()) : -1;
    if (!partes || indice < 0) {
      throw new ErroDominio('COMPETENCIA_INVALIDA', `Competência inválida: "${s}" (use Mmm/AA, ex.: Jun/22)`, {
        valor: s,
      });
    }
    return Competencia.de(2000 + Number(partes[2]), indice + 1);
  }

  formatar(): string {
    return `${MESES[this.mes - 1]}/${String(this.ano % 100).padStart(2, '0')}`;
  }

  comparar(o: Competencia): -1 | 0 | 1 {
    const a = this.ano * 12 + this.mes;
    const b = o.ano * 12 + o.mes;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  proxima(): Competencia {
    return this.mes === 12 ? Competencia.de(this.ano + 1, 1) : Competencia.de(this.ano, this.mes + 1);
  }
}
