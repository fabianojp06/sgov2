'use client';

import type { ExplicacaoDesvio } from '../application/ia-desvio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { PainelIA, type RespostaIaTela } from './painel-ia';

// Explicação do desvio pela IA (US-090; IA-09; plano do P35). Só leitura: o texto volta para a tela, com as contas e os
// meses citados que estão nos números do sistema.
export type FiltrosDesvio = { proposta: string; de: string; ate: string; conta?: string; zeradas: boolean };
export type AcaoExplicarDesvio = (dados: FiltrosDesvio) => Promise<RespostaIaTela<ExplicacaoDesvio>>;

export function AjudaDesvioIA({ acao, filtros }: { acao: AcaoExplicarDesvio; filtros: FiltrosDesvio }) {
  return (
    <PainelIA<ExplicacaoDesvio>
      id="oxr-ia-desvio"
      titulo="Explicação do desvio pela IA"
      rotuloBotao="Pedir à IA a explicação do desvio"
      aviso={MENSAGENS_ORC.IA_SEM_NOMES}
      pedir={() => acao(filtros)}
    >
      {(s) => (
        <>
          <blockquote>{s.texto}</blockquote>
          {(s.contas.length > 0 || s.meses.length > 0) && <p>{`Citados: ${[...s.contas, ...s.meses].join(', ')}.`}</p>}
        </>
      )}
    </PainelIA>
  );
}
