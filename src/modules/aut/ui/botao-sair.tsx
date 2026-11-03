'use client';

import { useState } from 'react';
import { useFocoDialogo } from './foco-dialogo';
import { sairDoSistema } from './sair-cliente';

// Botão Sair com confirmação (RN0028): Sim encerra a sessão; Não fecha a caixa (A1).
export function BotaoSair({ aberto = false }: { aberto?: boolean }) {
  const [confirmando, setConfirmando] = useState(aberto);
  const [saindo, setSaindo] = useState(false);
  const { origem, nao, focarNao } = useFocoDialogo(confirmando);
  return (
    <>
      <button type="button" ref={origem} onClick={() => (confirmando ? focarNao() : setConfirmando(true))}>
        Sair
      </button>
      {confirmando ? (
        <div
          role="alertdialog"
          aria-labelledby="sair-pergunta"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !saindo) setConfirmando(false);
          }}
        >
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
          <button type="button" ref={nao} disabled={saindo} onClick={() => setConfirmando(false)}>
            Não
          </button>
        </div>
      ) : null}
    </>
  );
}
