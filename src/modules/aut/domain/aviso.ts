// Aviso da desativação do sistema (EP085 UC02.01 passo 2.7, UC02.16, RN0037, REQ0044). Arquivo puro:
// o componente cliente da casca usa o mesmo texto que o servidor. O texto fala em minutos; a contagem
// os arredonda para cima, para "0 minutos" não aparecer com segundos ainda por vir.
export const avisoDesativacao = (segundos: number): string =>
  `O sistema será desativado em ${Math.max(0, Math.ceil(segundos / 60))} minutos. Por favor, salve seus trabalhos correntes.`;
