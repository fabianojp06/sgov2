// Caracteres como o char_length do PostgreSQL conta (pontos de código): "🚀" é um, e não dois como
// no length do JS. Os limites de texto do orc espelham os CHECKs do banco e precisam contar igual.
export const contarCaracteres = (texto: string): number => [...texto].length;

// As marcas que cercam o texto digitado na mensagem à IA (plano do P14) não podem aparecer dentro dele.
// Tirar uma marca pode juntar os pedaços de outra ('<<>>><' → '<<<'), por isso a saída é montada como uma
// pilha: a cada caractere, se o fim vira '<<<' ou '>>>', os três saem. A saída nunca tem marca, e o custo é
// linear. O laço anterior ("repete até não mudar") era quadrático: '<>>'.repeat(k) + '><<'.repeat(k) pedia
// k+2 passadas, e 240 KB levavam 38 s de CPU (revisão 12.12 do #462, avisada pela frente B na #138).
export function semMarcas(t: string): string {
  const saida: string[] = [];
  for (const c of t) {
    saida.push(c);
    const n = saida.length;
    if (n >= 3 && (c === '<' || c === '>') && saida[n - 2] === c && saida[n - 3] === c) saida.length = n - 3;
  }
  return saida.join('');
}
