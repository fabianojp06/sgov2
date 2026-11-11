import { describe, expect, it } from 'vitest';
import { criarProvedorEmbeddingsFalso, DIMENSOES_FALSO } from './embeddings';

// Porta ProvedorEmbeddings (US-020): o contrato que um provedor real vai cumprir, provado no falso.
describe('ProvedorEmbeddings (falso)', () => {
  const p = criarProvedorEmbeddingsFalso();

  it('um vetor por texto, na ordem, com a dimensão declarada e norma 1', async () => {
    const v = await p.gerarEmbeddings(['material de escritório', 'viagem a serviço']);
    expect(v).toHaveLength(2);
    for (const x of v) {
      expect(x).toHaveLength(DIMENSOES_FALSO);
      expect(Math.hypot(...x)).toBeCloseTo(1, 10);
    }
    expect(v[0]).not.toEqual(v[1]);
  });

  it('determinístico e insensível a maiúsculas, acentos e espaços repetidos', async () => {
    const [a, b] = await p.gerarEmbeddings(['Material de  Escritório', 'material de escritorio']);
    expect(a).toEqual(b);
    expect(await p.gerarEmbeddings(['x'])).toEqual(await criarProvedorEmbeddingsFalso().gerarEmbeddings(['x']));
  });

  it('lista vazia, cancelamento e dimensão inválida', async () => {
    expect(await p.gerarEmbeddings([])).toEqual([]);
    await expect(p.gerarEmbeddings(['x'], AbortSignal.abort())).rejects.toThrow(/cancelado/);
    expect(() => criarProvedorEmbeddingsFalso(0)).toThrow();
    expect(criarProvedorEmbeddingsFalso(16).dimensoes).toBe(16);
  });
});
