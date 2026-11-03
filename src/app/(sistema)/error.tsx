'use client';

import { useState } from 'react';
import { MENSAGEM_ERRO_PAGINA, sairComErro } from './aut/sair-erro';

// Falha numa página da área logada (o carregamento do layout, E1 e E2 do UC01.03, é tratado nele).
// Tentar novamente usa o retry do Next, que pede a página de novo ao servidor (o reset só limparia o
// estado no cliente). Sair pede confirmação (RN0028) e encerra a sessão no servidor, como no E1.3.
export default function Erro({ retry }: { error: Error; reset: () => void; retry: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  return (
    <div role="alert">
      <p>{MENSAGEM_ERRO_PAGINA}</p>
      <button type="button" onClick={retry}>
        Tentar novamente
      </button>
      <button type="button" onClick={() => setConfirmando(true)}>
        Sair
      </button>
      {confirmando ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="sair-erro-pergunta">
          <p id="sair-erro-pergunta">Deseja realmente sair?</p>
          <button
            type="button"
            disabled={saindo}
            onClick={() => {
              setSaindo(true);
              void sairComErro(fetch, window.location, window.sessionStorage);
            }}
          >
            Sim
          </button>
          <button type="button" onClick={() => setConfirmando(false)}>
            Não
          </button>
        </div>
      ) : null}
    </div>
  );
}
