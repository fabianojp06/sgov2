import { falha, ok, type ErroCampo, type Resultado } from '@/shared/kernel';
import type { TipoColuna, ValorCelula } from '../domain/celula';

// Contrato C3: a forma da exportação para XLSX e a sua validação, sem o ExcelJS. Sai pelo index.ts
// (tipos e limite) para as telas; o gerador do arquivo sai só pelo servidor.ts (R22, Review Focus 10).
export type PlanilhaExportacao = {
  nome: string; // nome da aba: 1 a 31 caracteres, sem : \ / ? * [ ], sem apóstrofo nas pontas, único
  colunas: readonly { titulo: string; tipo: TipoColuna; largura?: number }[];
  linhas: readonly (readonly ValorCelula[])[]; // cada linha com um valor por coluna
};

export const LIMITE_EXPORTACAO_SINCRONA = 5000; // RF_IMP_003, total de linhas somando as abas

const PROIBIDOS_NA_ABA = /[:\\/?*[\]]/;

function nomeDeAbaValido(nome: string): boolean {
  return nome.length >= 1 && nome.length <= 31 && !PROIBIDOS_NA_ABA.test(nome) && !/^'|'$/.test(nome);
}

/** Valida as abas antes de gerar o arquivo (nomes do Excel, uma célula por coluna, limite síncrono). */
export function validarPlanilhas(planilhas: readonly PlanilhaExportacao[]): Resultado<void> {
  if (planilhas.length === 0) return falha([{ campo: 'planilhas', mensagem: 'Nada a exportar: nenhuma aba.' }]);
  const erros: ErroCampo[] = [];
  const vistos = new Set<string>();
  planilhas.forEach((p, i) => {
    if (!nomeDeAbaValido(p.nome)) {
      erros.push({
        campo: `planilhas.${i}.nome`,
        mensagem: `Nome de aba inválido: "${p.nome}" (1 a 31 caracteres, sem : \\ / ? * [ ] e sem apóstrofo nas pontas).`,
      });
    }
    const chave = p.nome.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) erros.push({ campo: `planilhas.${i}.nome`, mensagem: `Aba repetida: "${p.nome}".` });
    vistos.add(chave);
    const linhaErrada = p.linhas.findIndex((l) => l.length !== p.colunas.length);
    if (linhaErrada >= 0) {
      erros.push({
        campo: `planilhas.${i}.linhas`,
        mensagem: `A linha ${linhaErrada + 1} da aba "${p.nome}" não tem um valor por coluna (${p.colunas.length}).`,
      });
    }
  });
  const total = planilhas.reduce((soma, p) => soma + p.linhas.length, 0);
  if (total > LIMITE_EXPORTACAO_SINCRONA) {
    erros.push({
      campo: 'linhas',
      mensagem: `A exportação tem ${total} linhas; acima de ${LIMITE_EXPORTACAO_SINCRONA}, use a exportação assíncrona.`,
    });
  }
  return erros.length > 0 ? falha(erros) : ok(undefined);
}
