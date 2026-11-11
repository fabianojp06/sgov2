import { createHash } from 'node:crypto';

// Porta ProvedorEmbeddings (spec §4.4, US-020): a busca semântica futura (por exemplo, a ajuda
// contextual IA-18) transforma textos em vetores para o pgvector. O fornecedor fica para quando houver
// caso de uso (GAP-IA-002, decisão do PO/TI): por isso só existe o adaptador falso, para os testes e o
// dev. Quem chamar a porta passa pela mesma governança da IA (caso de uso, permissão, teto e registro)
// quando houver provedor real.

export type VetorEmbedding = readonly number[];

export interface ProvedorEmbeddings {
  /** Dimensão dos vetores (a coluna vector(n) do pgvector precisa ser igual). */
  readonly dimensoes: number;
  /** Um vetor por texto, na mesma ordem, com norma 1 (a distância de cosseno vira produto interno). */
  gerarEmbeddings(textos: readonly string[], sinal?: AbortSignal): Promise<readonly VetorEmbedding[]>;
}

export const DIMENSOES_FALSO = 8;

/**
 * Embeddings determinísticos, sem rede: o vetor vem do hash do texto normalizado (minúsculas, sem
 * acento e espaço repetido). Textos iguais dão vetores iguais; não há semântica nenhuma.
 */
export function criarProvedorEmbeddingsFalso(dimensoes = DIMENSOES_FALSO): ProvedorEmbeddings {
  if (!Number.isInteger(dimensoes) || dimensoes < 1 || dimensoes > 64) throw new Error(`dimensões inválidas: ${dimensoes}`);
  return {
    dimensoes,
    async gerarEmbeddings(textos, sinal) {
      if (sinal?.aborted) throw new Error('pedido de embeddings cancelado');
      return textos.map((t) => {
        const normal = t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
        const bytes = createHash('sha256').update(normal).digest();
        const v = Array.from({ length: dimensoes }, (_, i) => bytes[i % bytes.length]! / 255 - 0.5);
        const norma = Math.hypot(...v) || 1;
        return v.map((x) => x / norma);
      });
    },
  };
}
