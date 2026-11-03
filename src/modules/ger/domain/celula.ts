import { Competencia, Dinheiro, Percentual } from '@/shared/kernel';

// Tipos de coluna do contrato C3. Os valores atravessam a fronteira servidor → cliente como
// string (Server Components não serializam classes): dinheiro e percentual como string decimal
// ("1234.50", "51" = 51%), competência como "Mmm/AA" e data como ISO 8601 ("2027-03-05").
// Monte-os com os serializadores abaixo, nunca à mão.
export type TipoColuna = 'texto' | 'dinheiro' | 'percentual' | 'competencia' | 'data';
export type ValorCelula = string | null;

// Exibido quando o valor não está no formato do tipo da coluna.
export const CELULA_INVALIDA = '—';

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

export const celulaDinheiro = (d: Dinheiro): ValorCelula => d.paraString();
export const celulaPercentual = (p: Percentual): ValorCelula => p.paraString();
export const celulaCompetencia = (c: Competencia): ValorCelula => c.formatar();
// Dia civil no horário de Brasília (en-CA formata como AAAA-MM-DD). Para @db.Date do Prisma
// (meia-noite UTC), use celulaDataSemHora, que não desloca o dia.
const DIA_BRASILIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const celulaData = (d: Date): ValorCelula => DIA_BRASILIA.format(d);
export const celulaDataSemHora = (d: Date): ValorCelula => d.toISOString().slice(0, 10);

/** Data ISO do contrato → Date (meia-noite UTC), ou undefined se o dia não existe. Tela e planilha usam a mesma regra. */
export function lerDataIso(valor: string): Date | undefined {
  const partes = DATA_ISO.exec(valor);
  if (!partes) return undefined;
  const [, ano, mes, dia] = partes as unknown as [string, string, string, string];
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  // setUTCFullYear: Date.UTC trata os anos 0 a 99 como 1900 + ano.
  data.setUTCFullYear(Number(ano));
  const valida = data.getUTCFullYear() === Number(ano) && data.getUTCMonth() === Number(mes) - 1 && data.getUTCDate() === Number(dia);
  return valida ? data : undefined;
}

function formatarData(valor: string): string | undefined {
  const data = lerDataIso(valor);
  if (!data) return undefined;
  const [ano, mes, dia] = data.toISOString().slice(0, 10).split('-') as [string, string, string];
  return `${dia}/${mes}/${ano.padStart(4, '0')}`;
}

function formatarOuLancar(tipo: TipoColuna, valor: string): string {
  switch (tipo) {
    case 'dinheiro':
      return Dinheiro.de(valor).formatar();
    case 'percentual':
      return Percentual.dePontos(valor).formatar();
    case 'competencia':
      return Competencia.parse(valor).formatar();
    case 'data': {
      const texto = formatarData(valor);
      if (texto === undefined) throw new Error(`data inválida: ${valor}`);
      return texto;
    }
    case 'texto':
      return valor;
  }
}

// Formatação para exibição, sempre pelo kernel (nunca por number). Nunca lança: um valor fora
// do formato do tipo vira CELULA_INVALIDA, para uma célula ruim não derrubar a tela inteira.
export function formatarCelula(tipo: TipoColuna, valor: ValorCelula): string {
  if (valor === null) return '';
  try {
    return formatarOuLancar(tipo, valor);
  } catch (erro) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`formatarCelula: valor fora do formato do tipo "${tipo}"`, valor, erro);
    }
    return CELULA_INVALIDA;
  }
}
