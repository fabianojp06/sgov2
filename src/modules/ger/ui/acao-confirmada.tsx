'use client';

import { unstable_rethrow } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Contrato C3 (#230; R13 do plano do P6): a caixa de confirmação Sim/Não que o adm e o orc tinham
// em cópia. A Server Action do módulo dono vem por props e recebe os `campos` (id, versão) num
// FormData. Pelo index.ts do ger, que é seguro para componente cliente.
export type AcaoFormulario = (dados: FormData) => Promise<Resultado<unknown>>;

/** O FormData que a ação recebe: um campo por chave de `campos`. */
export function dadosDaAcao(campos: Readonly<Record<string, string>>): FormData {
  const dados = new FormData();
  for (const [nome, valor] of Object.entries(campos)) dados.set(nome, valor);
  return dados;
}

export const MENSAGEM_FALHA_ACAO = 'Não foi possível concluir a operação. Tente novamente.';

// Botão com caixa de confirmação Sim/Não. Ao abrir, o foco vai para o Não (a opção segura); ao
// fechar, volta ao botão de origem; Esc fecha. Depois do Sim, mostra o sucesso ou os erros do
// Resultado. A ação roda numa transição: o redirect dela segue pelo roteador do Next.
export function AcaoConfirmada({
  rotulo,
  pergunta,
  acao,
  campos,
  mensagemSucesso,
  aberto = false,
}: {
  rotulo: string;
  pergunta: string;
  acao: AcaoFormulario;
  campos: Readonly<Record<string, string>>;
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
      const dados = dadosDaAcao(campos);
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
