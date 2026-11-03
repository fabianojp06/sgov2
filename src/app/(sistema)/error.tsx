'use client';

import { MENSAGEM_ERRO_PAGINA } from './aut/sair-erro';
import { SairComConfirmacao } from './aut/sair-com-confirmacao';

// Falha numa página da área logada (o carregamento do layout, E1 e E2 do UC01.03, é tratado nele).
// Tentar novamente usa o retry do Next, que pede a página de novo ao servidor (o reset só limparia o
// estado no cliente). Sair pede confirmação (RN0028) e encerra a sessão no servidor, como no E1.3.
export default function Erro({ retry }: { error: Error; reset: () => void; retry: () => void }) {
  return (
    <div role="alert">
      <p>{MENSAGEM_ERRO_PAGINA}</p>
      <button type="button" onClick={retry}>
        Tentar novamente
      </button>
      <SairComConfirmacao />
    </div>
  );
}
