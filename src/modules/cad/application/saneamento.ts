import { encontrarMarcaVedada } from '@/shared/config';

// Marca neutra nas cargas (GAP-CAD-005, spec §6.7): a sigla vedada sai da descrição antes de
// gravar. Fica em application/ porque o domain/ não importa @/shared/config; o domínio recebe esta
// função injetada (validarPlanoContas).
export function sanearDescricao(texto: string): { texto: string; retirou: boolean } {
  let atual = texto;
  let retirou = false;
  for (let achadas = encontrarMarcaVedada(atual); achadas.length > 0; achadas = encontrarMarcaVedada(atual)) {
    for (const ocorrencia of new Set(achadas)) atual = atual.split(ocorrencia).join(' ');
    retirou = true;
  }
  if (!retirou) return { texto, retirou };
  // Sobras da retirada: espaços repetidos e separadores soltos nas pontas.
  const limpo = atual.replace(/\s+/g, ' ').replace(/^[\s\-–—/|,;:]+|[\s\-–—/|,;:]+$/g, '').trim();
  return { texto: limpo, retirou };
}
