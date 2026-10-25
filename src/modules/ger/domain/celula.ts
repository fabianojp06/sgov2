import { Competencia, Dinheiro, Percentual } from '@/shared/kernel';

// Tipos de coluna do contrato C3. Os valores atravessam a fronteira servidor → cliente como
// string (Server Components não serializam classes): dinheiro e percentual como string decimal
// ("1234.50", "51" = 51%), competência como "Mmm/AA" e data como ISO 8601 ("2027-03-05").
export type TipoColuna = 'texto' | 'dinheiro' | 'percentual' | 'competencia' | 'data';
export type ValorCelula = string | null;

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

// Formatação para exibição, sempre pelo kernel (nunca por number).
export function formatarCelula(tipo: TipoColuna, valor: ValorCelula): string {
  if (valor === null) return '';
  switch (tipo) {
    case 'dinheiro':
      return Dinheiro.de(valor).formatar();
    case 'percentual':
      return Percentual.dePontos(valor).formatar();
    case 'competencia':
      return Competencia.parse(valor).formatar();
    case 'data': {
      const partes = DATA_ISO.exec(valor);
      return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor;
    }
    case 'texto':
      return valor;
  }
}
