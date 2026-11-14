'use client';

// Imprimir a pré-visualização da proposta (US-068, D-P29-5): a impressão do navegador, sem registro no servidor.
export function BotaoImprimirPagina() {
  return (
    <button type="button" className="sem-impressao" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
