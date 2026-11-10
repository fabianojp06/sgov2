import { Competencia, Dinheiro, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { CELULA_INVALIDA, lerDataIso, type TipoColuna, type ValorCelula } from '../domain/celula';
import { linhasIdentificacao, validarPlanilhas, type PlanilhaExportacao } from './exportacao';

// Contrato C3: exportação para XLSX (US-021, R21). Só pelo servidor.ts (R22): o index.ts do ger é
// importado por componentes cliente e não pode alcançar o ExcelJS, nem por import dinâmico.
//
// Injeção de fórmula (M2): todo texto de dado é gravado como valor de texto (cell.value = string),
// nunca como { formula } nem { hyperlink }, inclusive o que começa com = + - @ \t ou \r. Dinheiro vai
// como número com #,##0.00, convertido do texto decimal (nunca por cálculo em number).
export async function exportarXlsx(planilhas: readonly PlanilhaExportacao[]): Promise<Resultado<Uint8Array>> {
  const v = validarPlanilhas(planilhas);
  if (!v.ok) return falha(v.erros);
  try {
    return ok(await gerar(planilhas));
  } catch (e) {
    // O ExcelJS ainda pode recusar algo que a validação não previu: vira erro, nunca rejeição. No log,
    // só a classe e a mensagem do ExcelJS, sem os dados das células.
    console.error('[XLSX_FALHOU]', { erro: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'desconhecido' });
    return falha([{ campo: 'planilhas', mensagem: 'Não foi possível gerar a planilha.' }]);
  }
}

async function gerar(planilhas: readonly PlanilhaExportacao[]): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const p of planilhas) {
    const ws = wb.addWorksheet(p.nome);
    // Sem `header` nas colunas: com a identificação (US-024), os títulos não ficam na linha 1.
    ws.columns = p.colunas.map((c) => ({
      // Largura em caracteres: cerca de 7 px por caractere (o Excel aceita até 255).
      width: c.largura ? Math.min(255, Math.max(4, Math.round(c.largura / 7))) : 18,
      ...(c.tipo === 'dinheiro' ? { style: { numFmt: '#,##0.00' } } : {}),
      // Em pontos (51 = 51%), com o símbolo literal para não confundir com fração.
      ...(c.tipo === 'percentual' ? { style: { numFmt: '#,##0.00##"%"' } } : {}),
      ...(c.tipo === 'data' ? { style: { numFmt: 'dd/mm/yyyy' } } : {}),
    }));
    if (p.identificacao) {
      // RN0011 e RN_WATERMARK: o cabeçalho legível no topo (título em negrito) e, na impressão, o
      // operador e o rastreio no rodapé. No rodapé do Excel, "&" é código: vira "&&".
      linhasIdentificacao(p.identificacao).forEach((t, n) => {
        const r = ws.addRow([textoXml(t)]);
        if (n === 0) r.font = { bold: true };
      });
      ws.addRow([]);
      // O Excel recusa cabeçalho ou rodapé acima de 255 caracteres: o operador vai cortado em 150, sem
      // partir um "&&" ao meio (o rastreio tem até 64 e não aceita "&").
      const rodape = (t: string, max: number) => {
        const r = textoXml(t).replace(/&/g, '&&').slice(0, max);
        return /(^|[^&])(&&)*&$/.test(r) ? r.slice(0, -1) : r;
      };
      ws.headerFooter.oddFooter = `&L${rodape(p.identificacao.operador, 150)}&RRastreio ${rodape(p.identificacao.rastreio, 64)}`;
    }
    ws.addRow(p.colunas.map((c) => textoXml(c.titulo))).font = { bold: true };
    for (const linha of p.linhas) {
      const r = ws.addRow([]);
      linha.forEach((v, i) => {
        r.getCell(i + 1).value = valorDaCelula(p.colunas[i]!.tipo, v);
      });
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// Só caracteres permitidos no XML 1.0 (um U+FFFE num cadastro estragaria o arquivo inteiro) e no
// máximo 32.767 por célula, o limite do Excel.
const FORA_DO_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
const LIMITE_CELULA = 32_767;
export function textoXml(t: string): string {
  return t.replace(FORA_DO_XML, '').slice(0, LIMITE_CELULA);
}

// Valor gravado na célula, sempre a partir do texto do contrato e pelo kernel. Fora do formato do
// tipo, o texto de célula inválida (como na tela); nunca uma exceção que derrube a exportação.
function valorDaCelula(tipo: TipoColuna, v: ValorCelula): string | number | Date | null {
  if (v === null) return null;
  try {
    switch (tipo) {
      case 'texto':
        return textoXml(v);
      case 'dinheiro':
        return Number(Dinheiro.de(v).paraString());
      case 'percentual':
        return Number(Percentual.dePontos(v).paraString());
      case 'competencia':
        return Competencia.parse(v).formatar();
      case 'data':
        return lerDataIso(v) ?? CELULA_INVALIDA;
    }
  } catch {
    return CELULA_INVALIDA;
  }
}
