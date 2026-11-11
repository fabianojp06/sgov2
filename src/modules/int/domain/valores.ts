// Leitura dos campos numéricos do cadastro da IA (US-019 parte 2), sem number para dinheiro.

/** "1.234,56", "1234,5", "1234.56" ou "150" → "1234.56": vírgula ou ponto decimal, até 2 casas e 10 dígitos inteiros. */
export function lerDolar(texto: string): string | null {
  const t = texto.trim().replace(/\s/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d{1,10})(?:,(\d{1,2}))?$/.exec(t) ?? /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const inteiro = m[1]!.replaceAll('.', '');
  if (inteiro.length > 10) return null;
  return `${BigInt(inteiro)}.${(m[2] ?? '').padEnd(2, '0')}`;
}

/** Inteiro de min a max, aceitando o ponto de milhar ("1.000"). */
export function inteiroEntre(texto: string, min: number, max: number): number | null {
  const t = texto.trim().replaceAll('.', '');
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}
