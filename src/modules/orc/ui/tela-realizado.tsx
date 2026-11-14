import type { PropostaParaRealizado, TelaRealizado as Dados } from '../application/realizado';
import { valorParaTela } from '../domain/valor-tela';
import { FormCargaRealizado, FormFecharCompetencia, type AcaoRealizado } from './form-realizado';

// Realizado do TP (US-085, parte 1; plano do P32, Task 3): o valor por competência (carga + ajustes lançados nela,
// RN_OXR_008), os ajustes de meses fechados com a origem (RN_OXR_006), as pendências (RN_OXR_004, E3) e as últimas
// cargas (REQ_OXR_005). Sem digitação de realizado (REQ_OXR_007): só o arquivo.

const mesTela = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const dataHora = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

function Escolha({ propostas }: { propostas: readonly PropostaParaRealizado[] }) {
  return (
    <section aria-labelledby="realizado-escolha">
      <h2 id="realizado-escolha">Escolha o Termo de Parceria</h2>
      {propostas.length === 0 ? (
        <p>Nenhum Termo de Parceria encontrado.</p>
      ) : (
        <ul>
          {propostas.map((p) => (
            <li key={p.id}>
              <a href={`/orc/realizado?proposta=${p.id}`}>{`Realizado do TP ${p.numero} – ${p.objeto}`}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TelaRealizado(props: {
  dados: Dados | null;
  propostas: readonly PropostaParaRealizado[];
  carregar: AcaoRealizado | null;
  fechar: AcaoRealizado | null;
}) {
  const { dados, propostas, carregar, fechar } = props;
  return (
    <>
      {!dados ? (
        <Escolha propostas={propostas} />
      ) : (
        <section aria-labelledby="realizado-titulo">
          <h2 id="realizado-titulo">{`${dados.numero} – ${dados.objeto}`}</h2>
          <p>{dados.atualizadoEm ? `Última atualização do realizado: ${dataHora(dados.atualizadoEm)}.` : 'O realizado deste TP ainda não foi carregado.'}</p>
          {dados.pendentes.length > 0 && (
            <p role="note">{`Existem ${dados.pendencias.quantidade} valores do ERP sem conta correspondente no SGO (R$ ${valorParaTela(dados.pendencias.valor)}).`}</p>
          )}
          {carregar && <FormCargaRealizado propostaId={dados.propostaId} carregar={carregar} />}
          <table>
            <caption>Realizado por competência</caption>
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th scope="col">Situação</th>
                <th scope="col">Realizado (R$)</th>
              </tr>
            </thead>
            <tbody>
              {dados.competencias.map((c) => (
                <tr key={c.competencia}>
                  <th scope="row">{mesTela(c.competencia)}</th>
                  <td>{c.fechada ? 'Fechada' : 'Aberta'}</td>
                  <td>{valorParaTela(c.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td />
                <td>{valorParaTela(dados.total)}</td>
              </tr>
            </tfoot>
          </table>
          {dados.ajustes.length > 0 && (
            <table>
              <caption>Ajustes de meses fechados</caption>
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Lançado em</th>
                  <th scope="col">Valor (R$)</th>
                </tr>
              </thead>
              <tbody>
                {dados.ajustes.map((a, i) => (
                  <tr key={i}>
                    <th scope="row">{a.conta}</th>
                    <td>{mesTela(a.origem)}</td>
                    <td>{mesTela(a.lancamento)}</td>
                    <td>{valorParaTela(a.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {dados.pendentes.length > 0 && (
            <table>
              <caption>Pendências: valores sem conta no SGO</caption>
              <thead>
                <tr>
                  <th scope="col">Conta do ERP</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Valor (R$)</th>
                </tr>
              </thead>
              <tbody>
                {dados.pendentes.map((p, i) => (
                  <tr key={i}>
                    <th scope="row">{p.conta}</th>
                    <td>{mesTela(p.competencia)}</td>
                    <td>{valorParaTela(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {dados.cargas.length > 0 && (
            <table>
              <caption>Últimas cargas</caption>
              <thead>
                <tr>
                  <th scope="col">Data e hora</th>
                  <th scope="col">Arquivo</th>
                  <th scope="col">Linhas</th>
                  <th scope="col">Total (R$)</th>
                  <th scope="col">Ajustes</th>
                  <th scope="col">Pendências</th>
                </tr>
              </thead>
              <tbody>
                {dados.cargas.map((c, i) => (
                  <tr key={i}>
                    <th scope="row">{dataHora(c.carregadoEm)}</th>
                    <td>{c.arquivo}</td>
                    <td>{c.linhas}</td>
                    <td>{valorParaTela(c.total)}</td>
                    <td>{c.ajustes}</td>
                    <td>{c.pendencias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {fechar && (
        <section aria-labelledby="realizado-fechamento">
          <h2 id="realizado-fechamento">Fechamento da competência</h2>
          <FormFecharCompetencia fechar={fechar} />
        </section>
      )}
    </>
  );
}
