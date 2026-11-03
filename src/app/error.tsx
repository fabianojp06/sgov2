'use client';

import { MENSAGEM_ERRO_PAGINA } from './(sistema)/aut/sair-erro';
import { SairComConfirmacao } from './(sistema)/aut/sair-com-confirmacao';

// Fronteira de erro da raiz: pega o que escapa das páginas fora da área logada e o erro de render da
// casca da área logada (TelaPrincipal), que o error.tsx de (sistema) não envolve. Sem ela, aparecia a
// página padrão do Next, em inglês. Mesmo texto e mesmas saídas do erro de página: Tentar novamente
// (retry do Next) e Sair com confirmação.
export default function ErroRaiz({ retry }: { error: Error; reset: () => void; retry: () => void }) {
  return (
    <main>
      <div role="alert">
        <p>{MENSAGEM_ERRO_PAGINA}</p>
        <button type="button" onClick={retry}>
          Tentar novamente
        </button>
        <SairComConfirmacao />
      </div>
    </main>
  );
}
