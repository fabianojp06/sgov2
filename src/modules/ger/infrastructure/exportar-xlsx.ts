import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import type { TipoColuna, ValorCelula } from '../domain/celula';

// Contrato C3: exportação para XLSX. Esta versão valida as entradas e devolve um arquivo vazio;
// a implementação real (P4) carrega o ExcelJS com `await import('exceljs')` dentro da função,
// para que ele não entre no bundle do navegador.
export type PlanilhaExportacao = {
  nome: string; // nome da aba, 1 a 31 caracteres, sem : \ / ? * [ ]
  colunas: readonly { titulo: string; tipo: TipoColuna; largura?: number }[];
  linhas: readonly (readonly ValorCelula[])[];
};

export const LIMITE_EXPORTACAO_SINCRONA = 5000; // RF_IMP_003, total de linhas somando as abas

const PROIBIDOS_NA_ABA = /[:\\/?*[\]]/;

export async function exportarXlsx(planilhas: readonly PlanilhaExportacao[]): Promise<Resultado<Uint8Array>> {
  const erros: ErroCampo[] = [];
  for (const p of planilhas) {
    if (p.nome.length < 1 || p.nome.length > 31 || PROIBIDOS_NA_ABA.test(p.nome)) {
      erros.push({ campo: 'nome', mensagem: `Nome de aba inválido: "${p.nome}" (1 a 31 caracteres, sem : \\ / ? * [ ]).` });
    }
  }
  const total = planilhas.reduce((soma, p) => soma + p.linhas.length, 0);
  if (total > LIMITE_EXPORTACAO_SINCRONA) {
    erros.push({
      campo: 'linhas',
      mensagem: `A exportação tem ${total} linhas; acima de ${LIMITE_EXPORTACAO_SINCRONA}, use a exportação assíncrona.`,
    });
  }
  if (erros.length > 0) return falha(erros);
  return ok(new Uint8Array());
}
