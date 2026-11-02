import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GradeArvore } from './grade-arvore';
import { visiveis, type NoGrade } from './grade-logica';
import { janelaVisivel, navegar } from './grade-virtual';

// Tree Grid virtualizada e teclado (plano do P4, Task 6a, Step 1).
describe('janelaVisivel', () => {
  const p = { total: 5000, alturaLinha: 32, alturaVisivel: 600, folga: 10 };

  it('no topo: começa em 0 e desenha no máximo 30 linhas', () => {
    const j = janelaVisivel({ ...p, topo: 0 });
    expect(j.inicio).toBe(0);
    expect(j.fim).toBeLessThanOrEqual(29);
    expect(j.espacoAntes).toBe(0);
  });

  it('no fim: termina na última linha; a altura total é sempre 5000 × 32', () => {
    const j = janelaVisivel({ ...p, topo: 5000 * 32 - 600 });
    expect(j.fim).toBe(4999);
    expect(j.espacoDepois).toBe(0);
    for (const topo of [0, 12_345, 5000 * 32 - 600]) {
      const k = janelaVisivel({ ...p, topo });
      expect(k.espacoAntes + (k.fim - k.inicio + 1) * 32 + k.espacoDepois).toBe(5000 * 32);
    }
  });

  it('lista vazia não desenha nada', () => {
    expect(janelaVisivel({ ...p, total: 0, topo: 0 })).toEqual({ inicio: 0, fim: -1, espacoAntes: 0, espacoDepois: 0 });
  });
});

// 4 → 4.1 → (4.1.1, 4.1.2); 5
const arvore: NoGrade[] = [
  { id: '4', linha: {}, filhos: [{ id: '4.1', linha: {}, filhos: [{ id: '4.1.1', linha: {} }, { id: '4.1.2', linha: {} }] }] },
  { id: '5', linha: {} },
];

describe('navegar (teclado de treegrid)', () => {
  const tudoAberto = new Set(['4', '4.1']);
  const linhas = visiveis(arvore, tudoAberto);

  it('↓ no último fica no último; ↑ no primeiro fica no primeiro; Home e End', () => {
    expect(navegar(linhas, '5', 'ArrowDown', tudoAberto)).toEqual({ foco: '5' });
    expect(navegar(linhas, '4', 'ArrowUp', tudoAberto)).toEqual({ foco: '4' });
    expect(navegar(linhas, '4.1.1', 'ArrowDown', tudoAberto)).toEqual({ foco: '4.1.2' });
    expect(navegar(linhas, '4.1.1', 'Home', tudoAberto)).toEqual({ foco: '4' });
    expect(navegar(linhas, '4', 'End', tudoAberto)).toEqual({ foco: '5' });
  });

  it('→ abre o fechado, e no aberto desce ao primeiro filho; numa folha, nada', () => {
    const fechado = new Set<string>();
    expect(navegar(visiveis(arvore, fechado), '4', 'ArrowRight', fechado)).toEqual({ foco: '4', alternar: '4' });
    expect(navegar(linhas, '4', 'ArrowRight', tudoAberto)).toEqual({ foco: '4.1' });
    expect(navegar(linhas, '5', 'ArrowRight', tudoAberto)).toEqual({ foco: '5' });
  });

  it('← fecha o aberto, ou volta ao pai', () => {
    expect(navegar(linhas, '4.1', 'ArrowLeft', tudoAberto)).toEqual({ foco: '4.1', alternar: '4.1' });
    expect(navegar(linhas, '4.1.2', 'ArrowLeft', tudoAberto)).toEqual({ foco: '4.1' });
    expect(navegar(linhas, '5', 'ArrowLeft', tudoAberto)).toEqual({ foco: '5' });
  });
});

describe('GradeArvore virtualizada (SSR)', () => {
  it('5.000 nós: no máximo 40 <tr> no corpo, aria-rowcount="5001" e props serializáveis', () => {
    const nos: NoGrade<'nome'>[] = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, linha: { nome: `Conta ${i}` } }));
    const props = { idGrade: 'teste', nos, colunas: [{ campo: 'nome' as const, titulo: 'Nome', tipo: 'texto' as const }] };
    expect(JSON.parse(JSON.stringify(props))).toEqual(props);
    const html = renderToString(createElement(GradeArvore<'nome'>, props));
    const corpo = html.slice(html.indexOf('<tbody'));
    const linhas = (corpo.match(/<tr\b/g) ?? []).length;
    expect(linhas).toBeGreaterThan(10);
    expect(linhas).toBeLessThanOrEqual(40);
    expect(html).toContain('aria-rowcount="5001"');
    expect(html).toContain('aria-rowindex="2"');
    expect(html).toContain('Conta 0');
    expect(html).not.toContain('Conta 4999');
    // Só uma linha entra na ordem de tabulação (foco itinerante).
    expect((corpo.match(/tabindex="0"/gi) ?? []).length).toBe(1);
  });
});
