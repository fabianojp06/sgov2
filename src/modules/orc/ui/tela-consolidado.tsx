import type { Consolidado } from '../application/consolidado';
import { ROTULO_SITUACAO_PROPOSTA } from '../domain/proposta';
import { valorContabil } from './tela-totalizadores';

// Consolidado dos TPs (US-101; spec §6.7; plano do P31). Só leitura, sem atalho para as telas do TP (D-P31-4):
// o consolidado não dá acesso ao TP. O orçado é o Valor Global oficial (D-P31-2); o realizado é o carregado (US-085, D-P32-8).

export function TelaConsolidado({ dados }: { dados: Consolidado }) {
  return (
    <section aria-labelledby="consolidado-titulo">
      <h2 id="consolidado-titulo">Todos os Termos de Parceria</h2>
      <p role="note">O orçado é o Valor Global da última versão oficializada. O realizado é o carregado por arquivo, com os ajustes de meses fechados.</p>
      {dados.linhas.length === 0 ? (
        <p>Nenhum Termo de Parceria ativo.</p>
      ) : (
        <div role="region" aria-labelledby="consolidado-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption id="consolidado-caption">Consolidado dos TPs, valores em R$</caption>
            <thead>
              <tr>
                <th scope="col">TP</th>
                <th scope="col">Tipo</th>
                <th scope="col">Situação da última versão</th>
                <th scope="col">Versão oficial</th>
                <th scope="col">Orçado</th>
                <th scope="col">Realizado</th>
                <th scope="col">% de realização</th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l) => (
                <tr key={l.numero}>
                  <th scope="row">{`${l.numero} – ${l.objeto}`}</th>
                  <td>{l.tipo}</td>
                  <td>{`${ROTULO_SITUACAO_PROPOSTA[l.situacao]} (Versão ${l.versaoAtual})`}</td>
                  <td>{l.versaoOficial === null ? 'Não oficializado' : `Versão ${l.versaoOficial}`}</td>
                  <td>{l.orcado ? valorContabil(l.orcado) : '—'}</td>
                  <td>{l.orcado ? valorContabil(l.realizado) : '—'}</td>
                  <td>{l.percentual ? l.percentual.formatar() : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{`Total dos ${dados.oficializados} TP(s) oficializado(s)`}</th>
                <td />
                <td />
                <td />
                <td>{valorContabil(dados.totalOrcado)}</td>
                <td>{valorContabil(dados.totalRealizado)}</td>
                <td>{dados.percentual ? dados.percentual.formatar() : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
