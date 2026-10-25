'use client';

import { useState } from 'react';
import { sairDoSistema } from './sair-cliente';

// Botão Sair com confirmação (RN0028): Sim encerra a sessão; Não fecha a caixa (A1).
export function BotaoSair({ aberto = false }: { aberto?: boolean }) {
  const [confirmando, setConfirmando] = useState(aberto);
  const [saindo, setSaindo] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setConfirmando(true)}>
        Sair
      </button>
      {confirmando ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby="sair-pergunta">
          <p id="sair-pergunta">Deseja realmente sair?</p>
          <button
            type="button"
            disabled={saindo}
            onClick={() => {
              setSaindo(true);
              void sairDoSistema(fetch, window.location, window.sessionStorage);
            }}
          >
            Sim
          </button>
          <button type="button" onClick={() => setConfirmando(false)}>
            Não
          </button>
        </div>
      ) : null}
    </>
  );
}
