// Texto com caractere de controle (U+0000 a U+001F e U+007F): quebra de linha, tabulação, NUL...
// O navegador remove tabulação e quebra de linha ao interpretar URLs, e o SMTP usa CRLF para
// separar cabeçalhos; por isso destinos e destinatários com esses caracteres são recusados.
export function temCaractereDeControle(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}
