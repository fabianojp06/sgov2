import type { CronogramaTela, PropostaParaCronograma } from '../application/cronograma';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';

// Cronograma de desembolso da proposta (US-075; UC04.01; plano do P25, Task 2). Só leitura: as descrições, os
// valores e as quebras vêm do servidor (REQ_CD_002 e 003). Uma tabela por mês, com as linhas "Total de AAAA"
// em destaque (RN0254), e a previsão de despesas por conta e ano. O filtro de meta é um formulário GET (RN0250).

function Escolha({ propostas }: { propostas: readonly PropostaParaCronograma[] }) {
  return (
    <section aria-labelledby="cronograma-escolha">
      <h2 id="cronograma-escolha">Escolha a proposta</h2>
      {propostas.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        <ul>
          {propostas.map((p) => (
            <li key={p.id}>
              <a href={`/orc/cronograma?proposta=${p.id}`}>{`Cronograma de desembolso da proposta ${p.numero} – ${p.objeto}`}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TelaCronograma({ dados, propostas }: { dados: CronogramaTela | null; propostas: readonly PropostaParaCronograma[] }) {
  if (!dados) return <Escolha propostas={propostas} />;
  return (
    <section aria-labelledby="cronograma-titulo">
      <h2 id="cronograma-titulo">{`${dados.numero} – ${dados.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[dados.tipo]} · Versão ${dados.versaoNumero} · Meta: ${dados.meta} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[dados.situacao]}</span>
      </p>
      {dados.metas.length > 0 && (
        <form method="get" action="/orc/cronograma" role="search" aria-label="Filtrar o cronograma por meta">
          <input type="hidden" name="proposta" value={dados.propostaId} />
          <label htmlFor="cronograma-meta">Meta</label>
          <select id="cronograma-meta" name="meta" defaultValue={dados.metas.find((m) => m.rotulo === dados.meta)?.id ?? ''}>
            <option value="">Todos</option>
            {dados.metas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.rotulo}
              </option>
            ))}
          </select>{' '}
          <button type="submit">Filtrar</button>
        </form>
      )}
      {dados.semPessoal && <p role="note">{MENSAGENS_ORC.TOTALIZADOR_SEM_PESSOAL}</p>}
      {dados.pessoalNaoHomologado && <p role="note">{MENSAGENS_ORC.CRONOGRAMA_PESSOAL_NAO_HOMOLOGADO}</p>}
      {dados.viagensDistribuidas && <p role="note">{MENSAGENS_ORC.CRONOGRAMA_VIAGENS_DISTRIBUIDAS}</p>}
      {dados.avisos.map((a) => (
        <p key={a} role="note">
          {a}
        </p>
      ))}
      <div role="region" aria-labelledby="cronograma-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
        <table>
          <caption id="cronograma-caption">{`Cronograma de desembolso da proposta ${dados.numero}, valores em R$`}</caption>
          <thead>
            <tr>
              <th scope="col">Parcela</th>
              <th scope="col">Desembolso</th>
              <th scope="col">Desembolso acumulado</th>
              <th scope="col">% acumulado</th>
              <th scope="col">Repasse do ciclo de 12 meses</th>
            </tr>
          </thead>
          <tbody>
            {dados.linhas.map((l) => (
              <tr key={l.descricao} className={l.tipo === 'ANO' ? 'fechamento' : undefined} style={l.tipo === 'ANO' ? { fontWeight: 700 } : undefined}>
                <th scope="row">{l.descricao}</th>
                <td>{valorParaTela(l.desembolso)}</td>
                <td>{valorParaTela(l.acumulado)}</td>
                <td>{l.percentualAcumulado ? `${l.percentualAcumulado.paraString().slice(0, -2).replace('.', ',')}%` : '—'}</td>
                <td>{l.repasseCiclo ? valorParaTela(l.repasseCiclo) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>Valor Global:</strong> {`R$ ${valorParaTela(dados.valorGlobal)}`}
        {dados.meta !== 'Todos' && <span>{` · Total da meta: R$ ${valorParaTela(dados.total)}`}</span>}
      </p>
      {dados.porConta.length > 0 && (
        <div role="region" aria-labelledby="previsao-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption id="previsao-caption">{`Previsão de despesas por conta e ano da proposta ${dados.numero}, valores em R$`}</caption>
            <thead>
              <tr>
                <th scope="col">Conta</th>
                {dados.anos.map((a) => (
                  <th key={a} scope="col">
                    {a}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {dados.porConta.map((c) => (
                <tr key={c.conta}>
                  <th scope="row">{`${c.conta} – ${c.descricao}`}</th>
                  {dados.anos.map((a) => (
                    <td key={a}>{c.anos[a] ? valorParaTela(c.anos[a]) : '0,00'}</td>
                  ))}
                  <td>{valorParaTela(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <a href="/orc/cronograma">Escolher outra proposta</a>
      </p>
    </section>
  );
}
