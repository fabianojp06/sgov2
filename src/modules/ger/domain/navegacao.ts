import { temCaractereDeControle } from './texto';

// Destinos de navegação dos componentes do ger (href da grade, redirecionamento do formulário):
// só caminhos do próprio sistema, para um dado gravado não levar a outro site (open redirect)
// nem executar javascript:. A barra invertida e os caracteres de controle são recusados porque
// o navegador os normaliza ("/\t/x" e "/\/x" viram "//x", outro site).
export function ehCaminhoInterno(destino: string): boolean {
  return (
    destino.startsWith('/') &&
    !destino.startsWith('//') &&
    !destino.includes('\\') &&
    !temCaractereDeControle(destino)
  );
}
