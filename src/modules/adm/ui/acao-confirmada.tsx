'use client';

import { unstable_rethrow } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Server Action do adm recebida por props (FormData com o id, ou o formulário inteiro).
export type AcaoComId = (dados: FormData) => Promise<Resultado<unknown>>;

export const MENSAGEM_FALHA_ACAO = 'Não foi possível concluir a operação. Tente novamente.';

// Botão com caixa de confirmação Sim/Não (UC02.13 A2 e A3; Não e Esc fecham a caixa, A7 e A8).
// Ao abrir, o foco vai para o Não (a opção segura); ao fechar, volta ao botão de origem. Depois do
// Sim, mostra a mensagem de sucesso ou os erros do Resultado. A ação roda numa transição: o
// redirect dela segue pelo roteador do Next, como no Formulario do C3.
export function AcaoConfirmada({
  rotulo,
  pergunta,
  acao,
  id,
  mensagemSucesso,
  aberto = false,
}: {
  rotulo: string;
  pergunta: string;
  acao: AcaoComId;
  id: string;
  mensagemSucesso?: string;
  aberto?: boolean;
}) {
  const [confirmando, setConfirmando] = useState(aberto);
  const [pendente, iniciarTransicao] = useTransition();
  const [erros, setErros] = useState<readonly ErroCampo[]>([]);
  const [sucesso, setSucesso] = useState(false);
  const idPergunta = useId();
  const origem = useRef<HTMLButtonElement>(null);
  const nao = useRef<HTMLButtonElement>(null);
  const abriu = useRef(false);

  useEffect(() => {
    if (confirmando) {
      abriu.current = true;
      nao.current?.focus();
    } else if (abriu.current) {
      origem.current?.focus();
    }
  }, [confirmando]);

  const abrir = () => {
    setErros([]);
    setSucesso(false);
    setConfirmando(true);
  };

  const confirmar = () =>
    iniciarTransicao(async () => {
      const dados = new FormData();
      dados.set('id', id);
      try {
        const r = await acao(dados);
        if (r.ok) setSucesso(true);
        else setErros(r.erros);
      } catch (erro) {
        unstable_rethrow(erro); // redirect e notFound seguem para o Next
        setErros([{ campo: '', mensagem: MENSAGEM_FALHA_ACAO }]);
      } finally {
        setConfirmando(false);
      }
    });

  return (
    <>
      <button type="button" ref={origem} onClick={abrir} disabled={pendente}>
        {rotulo}
      </button>
      {confirmando ? (
        <div
          role="alertdialog"
          aria-labelledby={idPergunta}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !pendente) setConfirmando(false);
          }}
        >
          <p id={idPergunta}>{pergunta}</p>
          <button type="button" disabled={pendente} onClick={confirmar}>
            Sim
          </button>
          <button type="button" ref={nao} disabled={pendente} onClick={() => setConfirmando(false)}>
            Não
          </button>
        </div>
      ) : null}
      {/* Região viva sempre montada: o leitor de tela anuncia quando o texto muda. */}
      <p role="status">{sucesso && mensagemSucesso ? mensagemSucesso : null}</p>
      {erros.length > 0 && (
        <ul role="alert">
          {erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
    </>
  );
}
