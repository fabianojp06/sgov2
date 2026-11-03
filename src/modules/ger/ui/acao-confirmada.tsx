'use client';

import { unstable_rethrow } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Contrato C3 (#230; R13 do plano do P6): a caixa de confirmação Sim/Não que o adm e o orc tinham
// em cópia. A Server Action do módulo dono vem por props e recebe os `campos` (id, versão) num
// FormData. Pelo index.ts do ger, que é seguro para componente cliente.
export type AcaoFormulario = (dados: FormData) => Promise<Resultado<unknown>>;

/** O FormData que a ação recebe: um campo por chave de `campos` (auxiliar; não sai pelo index.ts). */
export function dadosDaAcao(campos: Readonly<Record<string, string>>): FormData {
  const dados = new FormData();
  for (const [nome, valor] of Object.entries(campos)) dados.set(nome, valor);
  return dados;
}

export const MENSAGEM_FALHA_ACAO = 'Não foi possível concluir a operação. Tente novamente.';

/**
 * Roda a ação depois do Sim: sucesso ou os erros do Resultado; redirect e notFound seguem para o
 * Next (unstable_rethrow); outra exceção vira MENSAGEM_FALHA_ACAO (auxiliar; não sai pelo index.ts).
 */
export async function executarAcao(acao: AcaoFormulario, campos: Readonly<Record<string, string>>): Promise<{ sucesso: true } | { erros: readonly ErroCampo[] }> {
  try {
    const r = await acao(dadosDaAcao(campos));
    return r.ok ? { sucesso: true } : { erros: r.erros };
  } catch (erro) {
    unstable_rethrow(erro);
    return { erros: [{ campo: '', mensagem: MENSAGEM_FALHA_ACAO }] };
  }
}

// Botão com caixa de confirmação Sim/Não. Ao abrir, o foco vai para o Não (a opção segura); ao
// fechar, volta ao botão de origem; Esc fecha. Depois do Sim, mostra o sucesso ou os erros do
// Resultado. A ação roda numa transição: o redirect dela segue pelo roteador do Next. A caixa não é
// modal de propósito (UC02.13 A7/A8): sem aria-modal nem trava de foco; Esc fecha com o foco nela.
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
  /** Só o estado inicial (testes e telas que já abrem perguntando); mudar a prop depois não reabre. */
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

  // O foco volta à origem só quando ela já está habilitada: o setState depois do await não entra na
  // transição, e a caixa pode fechar com o botão ainda disabled (o focus() seria ignorado).
  useEffect(() => {
    if (confirmando) {
      abriu.current = true;
      nao.current?.focus();
    } else if (abriu.current && !pendente) {
      abriu.current = false;
      origem.current?.focus();
    }
  }, [confirmando, pendente]);

  const abrir = () => {
    setErros([]);
    setSucesso(false);
    setConfirmando(true);
  };

  const confirmar = () =>
    iniciarTransicao(async () => {
      try {
        const r = await executarAcao(acao, campos);
        if ('sucesso' in r) setSucesso(true);
        else setErros(r.erros);
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
