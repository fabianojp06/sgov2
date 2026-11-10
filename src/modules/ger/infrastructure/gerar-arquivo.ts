import { falha, type Resultado } from '@/shared/kernel';
import type { FormatoArquivo } from '../application/download';
import { LIMITE_EXPORTACAO_PDF, LIMITE_EXPORTACAO_SINCRONA, type OpcoesGeracao, type PlanilhaExportacao } from './exportacao';
import { exportarCsv } from './exportar-csv';
import { exportarPdf } from './exportar-pdf';
import { exportarXlsx } from './exportar-xlsx';

/**
 * Contrato C3: o arquivo no formato pedido (US-024). O CSV tem uma aba só. O PDF respeita o próprio
 * teto (LIMITE_EXPORTACAO_PDF), também quando o worker passa o limite assíncrono.
 */
export async function gerarArquivo(formato: FormatoArquivo, planilhas: readonly PlanilhaExportacao[], opcoes: OpcoesGeracao = {}): Promise<Resultado<Uint8Array>> {
  switch (formato) {
    case 'xlsx':
      return exportarXlsx(planilhas, opcoes);
    case 'csv':
      if (planilhas.length !== 1) return falha([{ campo: 'planilhas', mensagem: 'O CSV tem uma aba só.' }]);
      return exportarCsv(planilhas[0]!, opcoes);
    case 'pdf':
      return exportarPdf(planilhas, { limite: Math.min(opcoes.limite ?? LIMITE_EXPORTACAO_SINCRONA, LIMITE_EXPORTACAO_PDF) });
  }
}
