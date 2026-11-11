import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { MAXIMO_ACHADOS_IA, MAXIMO_REFERENCIAS_IA, MAXIMO_TEXTO_IA, RESPOSTA_REVISOR } from './revisor-processamento';

// Formato da resposta do revisor (US-064): o que passa dos limites é cortado, e não reprovado; o schema
// continua representável em JSON Schema (a saída estruturada do provedor depende disso).
describe('RESPOSTA_REVISOR', () => {
  it('corta achados, referências e texto acima dos limites', () => {
    const ref = { tipo: 'pacote', id: 'PAC-1' };
    const achado = { tipo: 'OUTRO', referencias: Array(MAXIMO_REFERENCIAS_IA + 5).fill(ref), texto: `  ${'á'.repeat(MAXIMO_TEXTO_IA + 10)}  ` };
    const r = RESPOSTA_REVISOR.parse({ achados: Array(MAXIMO_ACHADOS_IA + 3).fill(achado) });
    expect(r.achados).toHaveLength(MAXIMO_ACHADOS_IA);
    expect(r.achados[0]!.referencias).toHaveLength(MAXIMO_REFERENCIAS_IA);
    expect([...r.achados[0]!.texto]).toHaveLength(MAXIMO_TEXTO_IA);
    expect(RESPOSTA_REVISOR.safeParse({ achados: [{ ...achado, texto: '   ' }] }).success).toBe(false);
  });

  it('vira JSON Schema sem erro', () => {
    expect(() => z.toJSONSchema(RESPOSTA_REVISOR, { reused: 'ref' })).not.toThrow();
  });
});
