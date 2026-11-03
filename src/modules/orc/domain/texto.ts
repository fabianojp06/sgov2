// Caracteres como o char_length do PostgreSQL conta (pontos de código): "🚀" é um, e não dois como
// no length do JS. Os limites de texto do orc espelham os CHECKs do banco e precisam contar igual.
export const contarCaracteres = (texto: string): number => [...texto].length;
