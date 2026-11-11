// Caracteres como o char_length do PostgreSQL conta (pontos de código): "🚀" é um, e não dois como
// no length do JS. Os limites de texto do orc espelham os CHECKs do banco e precisam contar igual.
export const contarCaracteres = (texto: string): number => [...texto].length;

// As marcas que cercam o texto digitado na mensagem à IA (plano do P14) não podem aparecer dentro dele.
// Repete até não mudar: tirar uma marca pode juntar os pedaços de outra ('<<>>><' → '<<<').
export function semMarcas(t: string): string {
  let atual = t;
  for (;;) {
    const limpo = atual.replaceAll('<<<', '').replaceAll('>>>', '');
    if (limpo === atual) return limpo;
    atual = limpo;
  }
}
