'use client';

// Último recurso: erro no próprio layout raiz. Substitui o layout inteiro, por isso traz o html, o
// body e o título (o metadata do layout não vale aqui). Sem dependência de módulo: só o texto em
// português [PROVISÓRIO] e o Tentar novamente.
const MENSAGEM_ERRO_GERAL = 'O sistema não pôde ser exibido. Tente novamente em instantes.';

export default function ErroGeral({ retry }: { error: Error; reset: () => void; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <title>SGO 2.0</title>
        <main>
          <p role="alert">{MENSAGEM_ERRO_GERAL}</p>
          <button type="button" onClick={retry}>
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
}
