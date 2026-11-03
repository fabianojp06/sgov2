'use client';

import { useEffect, useRef } from 'react';

// Foco das caixas Sim/Não do aut, no padrão da AcaoConfirmada: ao abrir, o foco vai para o Não (a
// opção segura); ao fechar, volta ao botão de origem. O Esc fica no onKeyDown da caixa. Sem
// aria-modal: o foco não fica preso, e a caixa não deve prometer isso ao leitor de tela.
export function useFocoDialogo<O extends HTMLElement = HTMLButtonElement>(aberto: boolean) {
  const origem = useRef<O>(null);
  const nao = useRef<HTMLButtonElement>(null);
  const abriu = useRef(false);
  useEffect(() => {
    if (aberto) {
      abriu.current = true;
      nao.current?.focus();
    } else if (abriu.current) {
      origem.current?.focus();
    }
  }, [aberto]);
  // Clicar de novo no botão de origem com a caixa já aberta só devolve o foco ao Não.
  const focarNao = () => nao.current?.focus();
  return { origem, nao, focarNao };
}
