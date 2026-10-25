// Login sem diferenciar maiúsculas (RN0518) e no formato aprovado pelo PO (D-P5-3, spec §11.2a):
// letras minúsculas sem acento, dígitos, ponto, hífen e sublinhado, de 3 a 60 caracteres,
// começando por letra ou dígito (sem logins só de pontuação, como '...').
const FORMATO = /^[a-z0-9][a-z0-9._-]{2,59}$/;

// Devolve o login normalizado ou null quando o formato é inválido. O toLowerCase vem depois do
// teste de ASCII: 'İ'.toLowerCase() vira 'i̇' (dois code points), e não pode ser aceito como 'i'.
export function normalizarLogin(bruto: string): string | null {
  const aparado = bruto.trim();
  if (!/^[\x21-\x7e]+$/.test(aparado)) return null;
  const login = aparado.toLowerCase();
  return FORMATO.test(login) ? login : null;
}
