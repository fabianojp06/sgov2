// Texto com caractere de controle: C0 (U+0000 a U+001F, inclusive quebra de linha, tabulação e
// NUL), DEL e C1 (U+007F a U+009F), separadores de linha e parágrafo (U+2028, U+2029) e os de
// direção bidirecional (U+202A a U+202E, U+2066 a U+2069), que falseiam a ordem do texto exibido.
// O navegador remove tabulação e quebra de linha ao interpretar URLs, e o SMTP usa CRLF para
// separar cabeçalhos; por isso destinos, destinatários e dados de e-mail com eles são recusados.
export function temCaractereDeControle(texto: string): boolean {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
    if (c === 0x2028 || c === 0x2029) return true;
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return true;
  }
  return false;
}
