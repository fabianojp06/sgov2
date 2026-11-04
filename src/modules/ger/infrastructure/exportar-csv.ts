import { Competencia, Dinheiro, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { CELULA_INVALIDA, lerDataIso, type TipoColuna, type ValorCelula } from '../domain/celula';
import { validarPlanilhas, type PlanilhaExportacao } from './exportacao';

// Contrato C3: exportação para CSV (issue #233, R17 do P6), na mesma forma do XLSX (uma aba).
// Formato do Excel em pt-BR: BOM UTF-8, separador ";", vírgula decimal, linhas com \r\n e todo
// campo entre aspas (RFC 4180, aspas internas dobradas).
//
// Injeção de fórmula: no CSV, o Excel e o LibreOffice avaliam o texto que começa com = + - @, tab
// ou \r (e as formas de largura total). Todo texto (dados e títulos) que começa assim, mesmo depois
// de espaços, ganha um apóstrofo na frente e é lido como texto. Dinheiro e percentual saem do
// kernel, nunca do texto livre, então o "-" de um valor negativo não é escapado.
export function exportarCsv(planilha: PlanilhaExportacao): Resultado<Uint8Array> {
  const v = validarPlanilhas([planilha]);
  if (!v.ok) return falha(v.erros);
  const linhas = [
    planilha.colunas.map((c) => campo(textoSeguro(c.titulo))),
    ...planilha.linhas.map((l) => l.map((valor, i) => campo(valorDoCampo(planilha.colunas[i]!.tipo, valor)))),
  ];
  const texto = linhas.map((l) => l.join(SEPARADOR)).join('\r\n') + '\r\n';
  return ok(new TextEncoder().encode(BOM + texto));
}

const BOM = '\uFEFF';
const SEPARADOR = ';';
const LIMITE_CAMPO = 32_767; // o Excel corta a célula acima disso
const INICIO_DE_FORMULA = /^[ \u00A0]*[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

/** Texto livre pronto para o CSV: sem NUL, no limite do Excel e com o apóstrofo contra fórmula. */
export function textoSeguro(t: string): string {
  const limpo = t.replace(/\0/g, '');
  return (INICIO_DE_FORMULA.test(limpo) ? `'${limpo}` : limpo).slice(0, LIMITE_CAMPO);
}

const campo = (t: string): string => `"${t.replace(/"/g, '""')}"`;

// Mesmas regras do XLSX: sempre pelo kernel, e o valor fora do formato do tipo vira CELULA_INVALIDA.
function valorDoCampo(tipo: TipoColuna, v: ValorCelula): string {
  if (v === null) return '';
  try {
    switch (tipo) {
      case 'texto':
        return textoSeguro(v);
      case 'dinheiro':
        return Dinheiro.de(v).paraString().replace('.', ',');
      case 'percentual':
        // Em pontos, com 2 a 4 casas, como o #,##0.00## do XLSX.
        return Percentual.dePontos(v).paraString().replace(/(\.\d\d\d*?)0+$/, '$1').replace('.', ',');
      case 'competencia':
        return Competencia.parse(v).formatar();
      case 'data': {
        const data = lerDataIso(v);
        if (!data) return CELULA_INVALIDA;
        const [ano, mes, dia] = data.toISOString().slice(0, 10).split('-') as [string, string, string];
        return `${dia}/${mes}/${ano}`;
      }
    }
  } catch {
    return CELULA_INVALIDA;
  }
}
