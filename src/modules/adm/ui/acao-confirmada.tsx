'use client';

import { useState } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Server Action do adm recebida por props (FormData com o id, ou o formulário inteiro).
export type AcaoComId = (dados: FormData) => Promise<Resultado<unknown>>;

// Botão com caixa de confirmação Sim/Não (UC02.13 A2 e A3; Não fecha a caixa, A7 e A8). Depois do
// Sim, mostra a mensagem de sucesso ou os erros do Resultado; quando a ação redireciona, a
// navegação acontece antes.
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
  const [pendente, setPendente] = useState(false);
  const [resultado, setResultado] = useState<{ ok: true } | { ok: false; erros: readonly ErroCampo[] } | null>(null);
  const idPergunta = `pergunta-${rotulo.toLowerCase().replace(/\s+/g, '-')}`;

  const confirmar = async () => {
    setPendente(true);
    const dados = new FormData();
    dados.set('id', id);
    try {
      const r = await acao(dados);
      setResultado(r.ok ? { ok: true } : { ok: false, erros: r.erros });
    } finally {
      setPendente(false);
      setConfirmando(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setConfirmando(true)} disabled={pendente}>
        {rotulo}
      </button>
      {confirmando ? (
        <div role="alertdialog" aria-modal="true" aria-labelledby={idPergunta}>
          <p id={idPergunta}>{pergunta}</p>
          <button type="button" disabled={pendente} onClick={() => void confirmar()}>
            Sim
          </button>
          <button type="button" disabled={pendente} onClick={() => setConfirmando(false)}>
            Não
          </button>
        </div>
      ) : null}
      {resultado?.ok && mensagemSucesso && <p role="status">{mensagemSucesso}</p>}
      {resultado && !resultado.ok && (
        <ul role="alert">
          {resultado.erros.map((e, i) => (
            <li key={i}>{e.mensagem}</li>
          ))}
        </ul>
      )}
    </>
  );
}
