// Destinos de navegação dos componentes do ger (href da grade, redirecionamento do formulário):
// só caminhos do próprio sistema, para um dado gravado não levar a outro site (open redirect)
// nem executar javascript:.
export function ehCaminhoInterno(destino: string): boolean {
  return destino.startsWith('/') && !destino.startsWith('//') && !destino.startsWith('/\\');
}
