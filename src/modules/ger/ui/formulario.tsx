'use client';

import { createContext, useActionState, useContext, useEffect, type ReactNode } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Contrato C3: formulário que chama a Server Action do módulo dono e mostra os erros do Resultado.
export type PropsFormulario<T> = {
  acao: (dados: FormData) => Promise<Resultado<T>>; // Server Action do módulo dono
  children: ReactNode; // campos com name = ErroCampo.campo; erro ao lado com <ErroDoCampo campo="…" />
  textoEnviar?: string;
  mensagemSucesso?: string;
  redirecionarPara?: string; // após ok: true
};

const ContextoErros = createContext<readonly ErroCampo[]>([]);

// Mensagem de erro de um campo, posta pelo consumidor ao lado do campo de mesmo name.
export function ErroDoCampo({ campo }: { campo: string }) {
  const erros = useContext(ContextoErros).filter((e) => e.campo === campo);
  if (erros.length === 0) return null;
  return (
    <span role="alert" data-campo={campo}>
      {erros.map((e) => e.mensagem).join(' ')}
    </span>
  );
}

export function Formulario<T>({ acao, children, textoEnviar, mensagemSucesso, redirecionarPara }: PropsFormulario<T>) {
  // useActionState espera (estado anterior, FormData): a acao do contrato recebe só o FormData.
  const [estado, enviar, pendente] = useActionState(
    (_anterior: Resultado<T> | null, dados: FormData) => acao(dados),
    null,
  );
  const erros = estado && !estado.ok ? estado.erros : [];

  useEffect(() => {
    if (estado?.ok && redirecionarPara) window.location.assign(redirecionarPara);
  }, [estado, redirecionarPara]);

  return (
    <ContextoErros.Provider value={erros}>
      <form action={enviar} aria-busy={pendente}>
        {erros.length > 0 && (
          <ul role="alert">
            {erros.map((e, i) => (
              <li key={`${e.campo}-${i}`}>{e.mensagem}</li>
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
