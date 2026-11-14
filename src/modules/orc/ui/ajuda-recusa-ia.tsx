'use client';

import { useEffect, useRef, useState } from 'react';
import type { SugestaoRecusa } from '../application/ia-recusa';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { PainelIA, type RespostaIaTela } from './painel-ia';

// Ajuda da IA para redigir a recusa da oficialização (US-084, Task 2; plano do P30, D-P30-6). Fica dentro do
// formulário de rejeição da Central de Tarefas, que a recebe pronta da página (o apr não importa o orc). O
// rascunho vem do campo da justificativa; "Usar este texto" só preenche o campo, que continua editável. A marca
// sugestaoIa vai junto enquanto o campo continua igual ao texto aceito.
export type AcaoSugerirRecusa = (dados: { id: string; rascunho: string }) => Promise<RespostaIaTela<SugestaoRecusa>>;

const CAMPO = 'tarefa-justificativa';

export function AjudaRecusaIA({ acao, solicitacaoId }: { acao: AcaoSugerirRecusa; solicitacaoId: string }) {
  const aceito = useRef<string | null>(null);
  const [marcada, setMarcada] = useState(false);
  const campo = () => document.getElementById(CAMPO) as HTMLTextAreaElement | null;
  useEffect(() => {
    const area = campo();
    if (!area) return;
    const conferir = () => setMarcada(aceito.current !== null && area.value === aceito.current);
    area.addEventListener('input', conferir);
    return () => area.removeEventListener('input', conferir);
  }, []);
  const usar = (texto: string) => {
    const area = campo();
    if (!area) return;
    area.value = texto;
    aceito.current = texto;
    setMarcada(true);
    area.focus();
  };
  return (
    <>
      <input type="hidden" name="sugestaoIa" value="true" disabled={!marcada} />
      <PainelIA<SugestaoRecusa>
        id="tarefa-ia-recusa"
        titulo="Ajuda da IA na justificativa da recusa"
        rotuloBotao="Pedir ajuda da IA na justificativa da recusa"
        aviso={MENSAGENS_ORC.IA_SEM_NOMES}
        pedir={() => acao({ id: solicitacaoId, rascunho: campo()?.value ?? '' })}
      >
        {(s) => (
          <>
            <p>Texto sugerido:</p>
            <blockquote>{s.texto}</blockquote>
            <button type="button" onClick={() => usar(s.texto)}>
              Usar este texto
            </button>
            {s.pontos.length > 0 && (
              <>
                <p>Pontos de atenção:</p>
                <ul>
                  {s.pontos.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </PainelIA>
    </>
  );
}
