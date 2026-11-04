// Campos que mudaram entre o antes e o depois (valores já serializados para auditoria).
// Valor que não é objeto (texto, número, lista) é tratado como um campo único chamado "valor"; null e
// undefined viram registro vazio. Se um lado é primitivo e o outro é objeto (#172), o delta mistura
// esse "valor" com os campos reais do outro lado: é de propósito, para nada se perder. O auditar
// aceita qualquer valor; a convenção é auditar objeto nos dois lados.
export function calcularDelta(antes: unknown, depois: unknown): Record<string, { de: unknown; para: unknown }> {
  const a = comoRegistro(antes);
  const d = comoRegistro(depois);
  // Sem protótipo: a chave "__proto__" vira campo do delta, como no serializar (com {} ela sumiria).
  const delta = Object.create(null) as Record<string, { de: unknown; para: unknown }>;
  for (const chave of new Set([...Object.keys(a), ...Object.keys(d)])) {
    if (!iguais(a[chave], d[chave])) delta[chave] = { de: a[chave], para: d[chave] };
  }
  return { ...delta };
}

function comoRegistro(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return { valor: v };
}

export function iguais(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return (
    kx.length === ky.length &&
    kx.every((k) => iguais((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]))
  );
}
