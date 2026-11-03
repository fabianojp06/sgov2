'use client';

import { createContext, useActionState, useContext, useEffect, useMemo, useRef, useTransition, type FormEvent, type ReactNode } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';
import { ehCaminhoInterno } from '../domain/navegacao';
import { descricaoDoCampo, errosDoCampo, idErroDoCampo } from './formulario-logica';

// Contrato C3: formulário que chama a Server Action do módulo dono e mostra os erros do Resultado.
//
// Erros: um resumo único no topo, com role="alert" (o leitor de tela anuncia uma vez), e,
// ao lado de cada campo, <ErroDoCampo campo="…" /> sem role, com id `erro-<campo>`. Depois de cada
// resposta, o Formulario põe aria-invalid e o `erro-<campo>` no aria-describedby dos campos (e
// fieldsets) pelo name, só quando há erro, e tira quando não há (#229): funciona também com campos
// de componentes de servidor. No fieldset, <LegendaComErro campo="…"> põe o erro junto da legenda.
// Erro geral (sem campo) usa campo: ''.
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

/** Legenda de fieldset com o erro do grupo junto dela (#229). */
export function LegendaComErro({ campo, children }: { campo: string; children: ReactNode }) {
  return (
    <legend>
      {children} <ErroDoCampo campo={campo} />
    </legend>
  );
}

export function Formulario<T = unknown>({ acao, children, textoEnviar, mensagemSucesso, redirecionarPara }: PropsFormulario<T>) {
  const [estado, enviar, pendente] = useActionState(
    (_anterior: Resultado<T> | null, dados: FormData) => acao(dados),
    null,
  );
  const [, iniciarTransicao] = useTransition();
  // Memorizado: o efeito do aria só roda quando a resposta muda.
  const erros = useMemo(() => (estado && !estado.ok ? estado.erros : []), [estado]);
  const refForm = useRef<HTMLFormElement>(null);

  // aria-invalid e aria-describedby só com erro, pelo name do campo (#229).
  useEffect(() => {
    const form = refForm.current;
    if (!form) return;
    for (const el of Array.from(form.elements)) {
      const campo = el.getAttribute('name');
      if (!campo) continue;
      const temErro = errosDoCampo(erros, campo).length > 0;
      const descricao = descricaoDoCampo(el.getAttribute('aria-describedby'), campo, temErro);
      if (descricao) el.setAttribute('aria-describedby', descricao);
      else el.removeAttribute('aria-describedby');
      if (temErro) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
  }, [erros]);

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
      <form ref={refForm} onSubmit={aoEnviar} aria-busy={pendente} noValidate>
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
