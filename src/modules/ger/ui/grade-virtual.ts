// Lógica pura da virtualização e do teclado da GradeArvore (US-021; plano do P4, Task 6a, R18).
import type { LinhaVisivel } from './grade-logica';

export const ALTURA_LINHA_PADRAO = 32;
export const ALTURA_VISIVEL_PADRAO = 600;
export const FOLGA_PADRAO = 10;

/**
 * Faixa de linhas a desenhar para a rolagem `topo` (px), com `folga` linhas antes e depois, e os
 * espaçadores que mantêm a altura total (total × alturaLinha) para a barra de rolagem.
 */
export function janelaVisivel(p: { total: number; topo: number; alturaLinha: number; alturaVisivel: number; folga: number }): {
  inicio: number;
  fim: number;
  espacoAntes: number;
  espacoDepois: number;
} {
  if (p.total <= 0) return { inicio: 0, fim: -1, espacoAntes: 0, espacoDepois: 0 };
  const primeiraVisivel = Math.min(p.total - 1, Math.max(0, Math.floor(p.topo / p.alturaLinha)));
  const cabem = Math.ceil(p.alturaVisivel / p.alturaLinha);
  const inicio = Math.max(0, primeiraVisivel - p.folga);
  const fim = Math.min(p.total - 1, primeiraVisivel + cabem - 1 + p.folga);
  return { inicio, fim, espacoAntes: inicio * p.alturaLinha, espacoDepois: (p.total - 1 - fim) * p.alturaLinha };
}

export type Tecla = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';
export const TECLAS: readonly string[] = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];

/**
 * Navegação de treegrid (WAI-ARIA): ↓/↑ linha seguinte/anterior (parando nas pontas); → abre o nó
 * fechado ou desce ao primeiro filho; ← fecha o nó aberto ou sobe ao pai; Home/End, primeira e última.
 * Devolve o novo foco e, quando for o caso, o nó a abrir ou fechar.
 */
export function navegar<C extends string>(
  linhas: readonly LinhaVisivel<C>[],
  focoId: string,
  tecla: Tecla,
  abertos: ReadonlySet<string>,
): { foco: string; alternar?: string } {
  if (linhas.length === 0) return { foco: focoId };
  const i = Math.max(0, linhas.findIndex((l) => l.no.id === focoId));
  const atual = linhas[i]!;
  const temFilhos = Boolean(atual.no.filhos?.length);
  switch (tecla) {
    case 'ArrowDown':
      return { foco: linhas[Math.min(i + 1, linhas.length - 1)]!.no.id };
    case 'ArrowUp':
      return { foco: linhas[Math.max(i - 1, 0)]!.no.id };
    case 'Home':
      return { foco: linhas[0]!.no.id };
    case 'End':
      return { foco: linhas[linhas.length - 1]!.no.id };
    case 'ArrowRight':
      if (!temFilhos) return { foco: atual.no.id };
      if (!abertos.has(atual.no.id)) return { foco: atual.no.id, alternar: atual.no.id };
      return { foco: linhas[i + 1]?.no.id ?? atual.no.id };
    case 'ArrowLeft': {
      if (temFilhos && abertos.has(atual.no.id)) return { foco: atual.no.id, alternar: atual.no.id };
      // O pai é a linha anterior mais próxima com nível menor.
      for (let j = i - 1; j >= 0; j--) if (linhas[j]!.nivel < atual.nivel) return { foco: linhas[j]!.no.id };
      return { foco: atual.no.id };
    }
  }
}
