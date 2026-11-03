'use client';

// Último recurso: erro no próprio layout raiz. Substitui o layout inteiro, por isso traz o html e o
// body. Sem dependência de módulo: só o texto em português e o Tentar novamente.
export const MENSAGEM_ERRO_GERAL = 'O sistema não pôde ser exibido. Tente novamente em instantes.';

export default function ErroGeral({ retry }: { error: Error; reset: () => void; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <main>
          <div role="alert">
            <p>{MENSAGEM_ERRO_GERAL}</p>
            <button type="button" onClick={retry}>
              Tentar novamente
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
