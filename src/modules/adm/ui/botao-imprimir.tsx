'use client';

import { useState, useTransition } from 'react';
import type { ErroCampo, Resultado } from '@/shared/kernel';

// Imprimir o Histórico (US-040): registra a impressão no servidor (com os filtros da tela) e abre a
// impressão do navegador. Recebe a ação por props.
export function BotaoImprimir({ registrar, parametros }: { registrar: (dados: FormData) => Promise<Resultado<void> | { ok: false; erros: readonly ErroCampo[] }>; parametros: Readonly<Record<string, string>> }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <span className="sem-impressao">
      <button
        type="button"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const dados = new FormData();
            for (const [k, v] of Object.entries(parametros)) dados.set(k, v);
            const r = await registrar(dados);
            if (r.ok) {
              setErro(null);
              window.print();
            } else setErro(r.erros[0]?.mensagem ?? 'Não foi possível imprimir.'); // [PROVISÓRIO]
          })
        }
      >
        Imprimir
      </button>
      {erro && <span role="alert">{erro}</span>}
    </span>
  );
}
