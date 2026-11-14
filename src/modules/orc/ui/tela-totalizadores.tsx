import type { PropostaParaTotalizar, TotalizadoresTela } from '../application/totalizadores';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { ROTULO_SEMAFORO, type NoTotal, type Semaforo } from '../domain/totalizador';
import { valorParaTela } from '../domain/valor-tela';

// Aba Totalizadores da proposta (US-074; UC03.02; plano do P23, Task 2). Só consulta (RN_TOT_01): nenhum botão
// nem campo. A árvore do plano de contas em <details> aninhados, que abrem e fecham sem JavaScript (REQ_TOT_001),
// com Orçado, Realizado, Saldo e o semáforo por linha (RN_TOT_04), em texto e cor. Valor negativo entre
// parênteses (RN_TOT_05).

const COR: Readonly<Record<Semaforo, string>> = { VERDE: '#1a7f37', AMARELO: '#9a6700', LARANJA: '#bc4c00', VERMELHO: '#cf222e' };

/** RN_TOT_05: "1.234,56", e o negativo entre parênteses. */
export const valorContabil = (v: Parameters<typeof valorParaTela>[0]) => (v.ehNegativo() ? `(${valorParaTela(v.negar())})` : valorParaTela(v));

function Valores({ no }: { no: NoTotal }) {
  return (
    <span>
      {` Orçado ${valorContabil(no.orcado)} · Realizado ${valorContabil(no.realizado)} · Saldo ${valorContabil(no.saldo)} · `}
      <span className="semaforo" style={{ color: COR[no.semaforo], fontWeight: 600 }}>{`Semáforo ${ROTULO_SEMAFORO[no.semaforo]}`}</span>
    </span>
  );
}

function No({ no }: { no: NoTotal }) {
  const rotulo = `${no.classificacao} – ${no.descricao}`;
  if (no.analitica || no.filhos.length === 0) {
    return (
      <li>
        <strong>{rotulo}</strong>
        <Valores no={no} />
      </li>
    );
  }
  return (
    <li>
      <details open={no.nivel <= 2}>
        <summary>
          <strong>{rotulo}</strong>
          <Valores no={no} />
        </summary>
        <ul>
          {no.filhos.map((f) => (
            <No key={f.classificacao} no={f} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function TelaTotalizadores({ dados, propostas }: { dados: TotalizadoresTela | null; propostas: readonly PropostaParaTotalizar[] }) {
  if (!dados) {
    return (
      <section aria-labelledby="totalizadores-escolha">
        <h2 id="totalizadores-escolha">Escolha a proposta</h2>
        {propostas.length === 0 ? (
          <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
        ) : (
          <ul>
            {propostas.map((p) => (
              <li key={p.id}>
                <a href={`/orc/totalizadores?proposta=${p.id}`}>{`Totalizadores da proposta ${p.numero} – ${p.objeto}`}</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby="totalizadores-titulo">
      <h2 id="totalizadores-titulo">{`${dados.numero} – ${dados.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[dados.tipo]} · Versão ${dados.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[dados.situacao]}</span>
      </p>
      {dados.semPessoal && <p role="note">{MENSAGENS_ORC.TOTALIZADOR_SEM_PESSOAL}</p>}
      {dados.avisos.map((a) => (
        <p key={a} role="note">
          {a}
        </p>
      ))}
      {dados.arvore.length === 0 && dados.foraDoPlano.length === 0 ? (
        <p>{MENSAGENS_ORC.TOTALIZADOR_SEM_DESPESA}</p>
      ) : (
        <ul aria-label={`Totais por conta da proposta ${dados.numero}, valores em R$`}>
          {dados.arvore.map((n) => (
            <No key={n.classificacao} no={n} />
          ))}
          {dados.foraDoPlano.length > 0 && (
            <li>
              <strong>{MENSAGENS_ORC.TOTALIZADOR_FORA_DO_PLANO}</strong>
              <ul>
                {dados.foraDoPlano.map((f) => (
                  <li key={f.conta}>{`${f.conta}: Orçado ${valorContabil(f.valor)}`}</li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      )}
      <p>
        <strong>Total geral (Valor Global):</strong> {`R$ ${valorContabil(dados.total)}`}
      </p>
      <p>
        <a href="/orc/totalizadores">Escolher outra proposta</a>
      </p>
    </section>
  );
}
