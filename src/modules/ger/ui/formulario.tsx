'use client';

import { createContext, useActionState, useContext, useEffect, useTransition, type FormEvent, type ReactNode } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';
import { ehCaminhoInterno } from '../domain/navegacao';
import { errosDoCampo, idErroDoCampo } from './formulario-logica';

// Contrato C3: formulário que chama a Server Action do módulo dono e mostra os erros do Resultado.
//
// Erros: um resumo único no topo, com role="alert" (o leitor de tela anuncia uma vez), e,
// ao lado de cada campo, <ErroDoCampo campo="…" /> sem role, com id `erro-<campo>` para o
// campo apontar por aria-describedby. Erro geral (sem campo) usa campo: ''.
//
// Navegação após sucesso: o preferido é redirect() dentro da própria Server Action.
// redirecionarPara serve para destino fixo e só aceita caminho interno.
export type PropsFormulario<T = unknown> = {
  acao: (dados: FormData) => Promise<Resultado<T>>; // Server Action do módulo dono
  children: ReactNode; // campos com name = ErroCampo.campo
  textoEnviar?: string;
  mensagemSucesso?: string;
  redirecionarPara?: string; // após ok: true; só caminho interno (começando por "/")
};

const ContextoErros = createContext<readonly ErroCampo[]>([]);

export function ErroDoCampo({ campo }: { campo: string }) {
  const mensagens = errosDoCampo(useContext(ContextoErros), campo);
  if (mensagens.length === 0) return null;
  return (
    <span id={idErroDoCampo(campo)} data-campo={campo}>
      {mensagens.join(' ')}
    </span>
  );
}

export function Formulario<T = unknown>({ acao, children, textoEnviar, mensagemSucesso, redirecionarPara }: PropsFormulario<T>) {
  const [estado, enviar, pendente] = useActionState(
    (_anterior: Resultado<T> | null, dados: FormData) => acao(dados),
    null,
  );
  const [, iniciarTransicao] = useTransition();
  const erros = estado && !estado.ok ? estado.erros : [];

  useEffect(() => {
    if (estado?.ok && redirecionarPara && ehCaminhoInterno(redirecionarPara)) window.location.assign(redirecionarPara);
  }, [estado, redirecionarPara]);

  // onSubmit em vez de <form action>: com action, o React 19 limpa os campos ao fim de toda
  // ação, e o usuário perderia o que digitou quando o Resultado volta com erro.
  const aoEnviar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    iniciarTransicao(() => enviar(dados));
  };

  return (
    <ContextoErros.Provider value={erros}>
      <form onSubmit={aoEnviar} aria-busy={pendente} noValidate>
        {erros.length > 0 && (
          <ul role="alert">
            {erros.map((e, i) => (
              <li key={i}>{e.mensagem}</li>
            ))}
          </ul>
        )}
        {estado?.ok && mensagemSucesso && <p role="status">{mensagemSucesso}</p>}
        {children}
        <button type="submit" disabled={pendente}>
          {textoEnviar ?? 'Salvar'}
        </button>
      </form>
    </ContextoErros.Provider>
  );
}
