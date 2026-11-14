import type { PreVisualizacao, OrigemValor } from '../application/pre-visualizacao';
import { CATEGORIAS_EMPREGADO, ROTULO_CATEGORIA_EMPREGADO } from '../domain/empregado';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_CATEGORIA_PROPOSTA, ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import type { NoTotal } from '../domain/totalizador';
import { BotaoImprimirPagina } from './botao-imprimir-pagina';
import { valorContabil } from './tela-totalizadores';

// Pré-visualização da proposta (US-068; UC03.38; plano do P29). Documento só leitura, na ordem do "Corpo" do
// UC03.38: a proposta, as metas, os quantitativos de pessoal por período e as contas (sintética, analítica,
// período, valor e origem), com os totais. O rodapé traz o título do relatório e a hora da emissão. Imprime
// pelo navegador, sem a barra do sistema (D-P29-5).

const ROTULO_ORIGEM: Readonly<Record<OrigemValor, string>> = { PESSOAL: 'Pessoal (motor de pessoal)', VIAGENS: 'Viagens', BENS: 'Bens', RATEIO: 'Rateio/ISS' };
const mesAno = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

/** As linhas da tabela de contas: cada nó do plano com a profundidade, em ordem (sintética antes das filhas). */
function linhas(nos: readonly NoTotal[], nivel = 0): { no: NoTotal; nivel: number }[] {
  return nos.flatMap((no) => [{ no, nivel }, ...linhas(no.filhos, nivel + 1)]);
}

export function TelaPreVisualizacao({ dados, emitidoEm }: { dados: PreVisualizacao; emitidoEm: string }) {
  const periodo = `${mesAno(dados.vigencia.inicio)} a ${mesAno(dados.vigencia.fim)}`;
  const contas = linhas(dados.arvore);
  return (
    <article aria-labelledby="previa-titulo">
      <style>{'@media print { nav, header, footer, .sgo-status, .sem-impressao { display: none !important; } }'}</style>
      <h2 id="previa-titulo">{`${dados.numero} – ${dados.objeto}`}</h2>
      <p className="sem-impressao">
        <BotaoImprimirPagina /> <a href="/orc/propostas">Voltar às propostas</a>
      </p>
      <section aria-labelledby="previa-proposta">
        <h3 id="previa-proposta">Proposta</h3>
        <dl>
          <dt>Número</dt>
          <dd>{dados.numero}</dd>
          <dt>Nome da proposta</dt>
          <dd>{dados.objeto}</dd>
          {dados.parceiro && (
            <>
              <dt>Parceiro</dt>
              <dd>{dados.parceiro}</dd>
            </>
          )}
          <dt>Tipo e categoria</dt>
          <dd>{`${ROTULO_TIPO_PROPOSTA[dados.tipo]} · ${ROTULO_CATEGORIA_PROPOSTA[dados.categoria]}`}</dd>
          <dt>Versão</dt>
          <dd>{`Versão ${dados.versaoNumero} · ${ROTULO_SITUACAO_PROPOSTA[dados.situacao]}`}</dd>
          <dt>Período</dt>
          <dd>{periodo}</dd>
          <dt>Valor Global</dt>
          <dd>{`R$ ${valorContabil(dados.valorGlobal)}`}</dd>
        </dl>
        {dados.semPessoal && <p role="note">{MENSAGENS_ORC.TOTALIZADOR_SEM_PESSOAL}</p>}
        {dados.avisos.map((a) => (
          <p key={a} role="note">
            {a}
          </p>
        ))}
      </section>

      {dados.categoria === 'META' && (
        <section aria-labelledby="previa-metas">
          <h3 id="previa-metas">Metas</h3>
          {dados.metas.length === 0 ? (
            <p>Nenhuma meta nesta versão.</p>
          ) : (
            <table>
              <caption>Metas da proposta, valores em R$</caption>
              <thead>
                <tr>
                  <th scope="col">Meta</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                {dados.metas.map((m) => (
                  <tr key={m.numero}>
                    <th scope="row">{`${m.numero} – ${m.nome}${m.ativa ? '' : ' (inativa)'}`}</th>
                    <td>{valorContabil(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section aria-labelledby="previa-pessoal">
        <h3 id="previa-pessoal">Empregados</h3>
        {dados.quantitativos.length === 0 ? (
          <p>Nenhum quantitativo de pessoal nesta versão.</p>
        ) : (
          <table>
            <caption>Quantitativos de pessoal por período</caption>
            <thead>
              <tr>
                <th scope="col">Período</th>
                {CATEGORIAS_EMPREGADO.map((c) => (
                  <th key={c} scope="col">
                    {ROTULO_CATEGORIA_EMPREGADO[c]}
                  </th>
                ))}
                <th scope="col">Total do período</th>
              </tr>
            </thead>
            <tbody>
              {dados.quantitativos.map((q) => (
                <tr key={q.id}>
                  <th scope="row">{`${mesAno(q.inicio)} a ${mesAno(q.fim)} (${q.documento}${q.meta ? ` · Meta ${q.meta}` : ''})`}</th>
                  {CATEGORIAS_EMPREGADO.map((c) => (
                    <td key={c}>{q.quantidades[c]}</td>
                  ))}
                  <td>{CATEGORIAS_EMPREGADO.reduce((s, c) => s + q.quantidades[c], 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total por categoria</th>
                {CATEGORIAS_EMPREGADO.map((c) => (
                  <td key={c}>{dados.totaisQuantitativos[c]}</td>
                ))}
                <td>{CATEGORIAS_EMPREGADO.reduce((s, c) => s + dados.totaisQuantitativos[c], 0)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section aria-labelledby="previa-contas">
        <h3 id="previa-contas">Contas</h3>
        {contas.length === 0 && dados.foraDoPlano.length === 0 ? (
          <p>{MENSAGENS_ORC.TOTALIZADOR_SEM_DESPESA}</p>
        ) : (
          <table>
            <caption>Contas da proposta, valores em R$</caption>
            <thead>
              <tr>
                <th scope="col">Conta</th>
                <th scope="col">Período</th>
                <th scope="col">Valor</th>
                <th scope="col">Origem</th>
              </tr>
            </thead>
            <tbody>
              {contas.map(({ no, nivel }) => (
                <tr key={no.classificacao}>
                  <th scope="row" style={{ paddingLeft: `${nivel}rem`, fontWeight: no.analitica ? 'normal' : 600 }}>{`${no.classificacao} – ${no.descricao}`}</th>
                  <td>{no.analitica ? periodo : ''}</td>
                  <td>{valorContabil(no.orcado)}</td>
                  <td>{no.analitica ? (dados.origens[no.classificacao] ?? []).map((o) => ROTULO_ORIGEM[o]).join(', ') : ''}</td>
                </tr>
              ))}
              {dados.foraDoPlano.map((f) => (
                <tr key={f.conta}>
                  <th scope="row">{`${f.conta} – ${MENSAGENS_ORC.TOTALIZADOR_FORA_DO_PLANO}`}</th>
                  <td>{periodo}</td>
                  <td>{valorContabil(f.valor)}</td>
                  <td>{(dados.origens[f.conta] ?? []).map((o) => ROTULO_ORIGEM[o]).join(', ')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total geral (Valor Global)</th>
                <td />
                <td>{valorContabil(dados.valorGlobal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* Não é <footer>: a regra de impressão esconde os footer da barra do sistema, e este rodapé sai impresso. */}
      <p className="rodape-relatorio">{`Relatório de Pré-Visualização do TP · ${dados.numero} · emitido em ${emitidoEm}`}</p>
    </article>
  );
}
