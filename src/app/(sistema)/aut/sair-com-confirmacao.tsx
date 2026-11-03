'use client';

import { useEffect, useRef, useState } from 'react';
import { sairComErro } from './sair-erro';

// Sair do error.tsx com a caixa Sim/Não (RN0028). Fica aqui, e não no aut, porque componente da pasta
// app não importa @/modules/* (o index do aut carrega código de servidor); o foco segue o
// useFocoDialogo do aut: ao abrir, o Não; ao fechar, o Sair; Esc fecha. Sem aria-modal, porque o
// foco não fica preso. `aberto` existe para o teste renderizar a caixa.
export function SairComConfirmacao({ aberto = false }: { aberto?: boolean }) {
  const [confirmando, setConfirmando] = useState(aberto);
  const [saindo, setSaindo] = useState(false);
  const sair = useRef<HTMLButtonElement>(null);
  const nao = useRef<HTMLButtonElement>(null);
  const abriu = useRef(false);

  useEffect(() => {
    if (confirmando) {
      abriu.current = true;
      nao.current?.focus();
    } else if (abriu.current) {
      sair.current?.focus();
    }
  }, [confirmando]);

  return (
    <>
      <button type="button" ref={sair} onClick={() => (confirmando ? nao.current?.focus() : setConfirmando(true))}>
        Sair
      </button>
      {confirmando ? (
        <div
          role="alertdialog"
          aria-labelledby="sair-erro-pergunta"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !saindo) setConfirmando(false);
          }}
        >
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
          <button type="button" ref={nao} disabled={saindo} onClick={() => setConfirmando(false)}>
            Não
          </button>
        </div>
      ) : null}
    </>
  );
}
