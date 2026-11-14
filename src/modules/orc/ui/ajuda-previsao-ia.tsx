'use client';

import type { SugestaoPrevisao } from '../application/ia-previsao';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { PainelIA, type RespostaIaTela } from './painel-ia';

// Destaque da IA na previsão de fechamento (US-091; IA-10; plano do P34, D-P34-3). Só leitura: o texto e os destaques
// voltam para a tela; o mês do estouro e o desvio de cada destaque são os do motor, não da IA.
export type AcaoDestacarRiscos = (dados: { proposta: string; ano: string }) => Promise<RespostaIaTela<SugestaoPrevisao>>;

const mesTela = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

export function AjudaPrevisaoIA({ acao, proposta, ano }: { acao: AcaoDestacarRiscos; proposta: string; ano: string }) {
  return (
    <PainelIA<SugestaoPrevisao>
      id="previsao-ia"
      titulo="Destaque da IA nas contas em risco"
      rotuloBotao="Pedir à IA o destaque das contas em risco"
      aviso={MENSAGENS_ORC.IA_SEM_NOMES}
      pedir={() => acao({ proposta, ano })}
    >
      {(s) => (
        <>
          <blockquote>{s.texto}</blockquote>
          {s.destaques.length > 0 && (
            <ul>
              {s.destaques.map((d) => (
                <li key={d.conta}>{`${d.conta} – ${d.descricao}: estouro em ${mesTela(d.mesEstouro)}, desvio de R$ ${d.desvio}. ${d.motivo}`}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </PainelIA>
  );
}
