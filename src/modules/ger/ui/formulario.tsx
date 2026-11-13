'use client';

import { unstable_rethrow } from 'next/navigation';
import { createContext, useActionState, useContext, useEffect, useMemo, useRef, useTransition, type FormEvent, type ReactNode } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';
import { ehCaminhoInterno } from '../domain/navegacao';
import { MENSAGEM_FALHA_ACAO } from './acao-confirmada';
import { aplicarAria, errosDoCampo, idErroDoCampo } from './formulario-logica';

// Contrato C3: formulário que chama a Server Action do módulo dono e mostra os erros do Resultado.
//
// Erros: um resumo único no topo, com role="alert" (o leitor de tela anuncia uma vez), e,
// ao lado de cada campo, <ErroDoCampo campo="…" /> sem role, com id `erro-<campo>`. Depois de cada
// resposta, o Formulario é dono do aria de erro (#229, regra em aplicarAria): o `erro-<campo>` só
// fica nos aria-describedby enquanto o campo tem erro, e o campo com name recebe aria-invalid;
// funciona também com campos de componentes de servidor. Grupo de radios ou checkboxes: o fieldset
// leva o name (ou o aria-describedby) do grupo. No fieldset, use <LegendaComErro campo="…"> OU um
// <ErroDoCampo> do mesmo campo, nunca os dois (o id se repetiria). Erro geral usa campo: ''.
//
// Navegação após sucesso: o preferido é redirect() dentro da própria Server Action.
// redirecionarPara serve para destino fixo e só aceita caminho interno.
//
// O que foi digitado nunca se perde (US-022): os campos não são limpos depois da resposta, e uma falha
// de rede ou exceção da ação vira MENSAGEM_FALHA_ACAO no resumo, em vez de derrubar a tela no
// error.tsx. A tela que abre o formulário num painel ou caixa o fecha em aoSucesso, que só roda com
// ok: true. Nada vai para o localStorage (RNF0002; teste sem-localstorage).
export type PropsFormulario<T = unknown> = {
  acao: (dados: FormData) => Promise<Resultado<T>>; // Server Action do módulo dono
  children: ReactNode; // campos com name = ErroCampo.campo
  textoEnviar?: string;
  mensagemSucesso?: string;
  redirecionarPara?: string; // após ok: true; só caminho interno (começando por "/")
  aoSucesso?: (valor: T) => void; // só após ok: true (ex.: fechar o painel do formulário)
};

// Exportado só para os testes (renderizar com erro sem uma Server Action); o index.ts não o expõe.
export const ContextoErros = createContext<readonly ErroCampo[]>([]);

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
  const temErro = errosDoCampo(useContext(ContextoErros), campo).length > 0;
  return (
    <legend>
      {children}
      {temErro && ' '}
      <ErroDoCampo campo={campo} />
    </legend>
  );
}

/**
 * Chama a ação do formulário: o Resultado dela; redirect e notFound seguem para o Next
 * (unstable_rethrow); outra exceção (rede, erro inesperado) vira MENSAGEM_FALHA_ACAO (auxiliar; não sai
 * pelo index.ts).
 */
export async function executarFormulario<T>(acao: (dados: FormData) => Promise<Resultado<T>>, dados: FormData): Promise<Resultado<T>> {
  try {
    return await acao(dados);
  } catch (erro) {
    unstable_rethrow(erro);
    return { ok: false, erros: [{ campo: '', mensagem: MENSAGEM_FALHA_ACAO }] };
  }
}

export function Formulario<T = unknown>({ acao, children, textoEnviar, mensagemSucesso, redirecionarPara, aoSucesso }: PropsFormulario<T>) {
  const [estado, enviar, pendente] = useActionState(
    (_anterior: Resultado<T> | null, dados: FormData) => executarFormulario(acao, dados),
    null,
  );
  const [, iniciarTransicao] = useTransition();
  // Memorizado: o efeito do aria só roda quando a resposta muda.
  const erros = useMemo(() => (estado && !estado.ok ? estado.erros : []), [estado]);
  const refForm = useRef<HTMLFormElement>(null);

  // aria-invalid e aria-describedby só com erro (#229); a regra está em aplicarAria.
  useEffect(() => {
    const form = refForm.current;
    if (form) aplicarAria(form.querySelectorAll('[name], [aria-describedby], [data-invalido-formulario]'), erros);
  }, [erros]);

  useEffect(() => {
    if (estado?.ok && redirecionarPara && ehCaminhoInterno(redirecionarPara)) window.location.assign(redirecionarPara);
  }, [estado, redirecionarPara]);

  // Uma vez por resposta com sucesso: o estado só muda quando chega outra resposta.
  const refAoSucesso = useRef(aoSucesso);
  useEffect(() => {
    refAoSucesso.current = aoSucesso;
  });
  useEffect(() => {
    if (estado?.ok) refAoSucesso.current?.(estado.valor);
  }, [estado]);

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
