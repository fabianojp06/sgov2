import { Dinheiro } from '@/shared/kernel';
import type { TelaViagens } from '../application/viagens-tp';
import { TEXTOS_DESPESAS } from './despesas-tp';

// Demonstrativo analítico de despesas com viagens do TP (US-097 parte 1; UC05.03): o título do TP, as colunas do
// período, as sintéticas de viagens (subcategorias) em negrito somando as analíticas e o total geral (REQ0287).
// Componente puro (sem estado).

const TOTAL_GERAL = 'Total Geral de Viagens e Diárias';
const VAZIO = 'Nenhuma despesa de viagem realizada no período. Marque "Exibir contas zeradas" para ver todas as contas de viagens.';
const dataBrasilia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const moeda = (v: string) => Dinheiro.de(v).formatar();
const DIREITA = { textAlign: 'right' } as const;

export function TabelaViagens({ relatorio: r }: { relatorio: NonNullable<TelaViagens['relatorio']> }) {
  return (
    <section aria-labelledby="viagens-titulo">
      <h2 id="viagens-titulo">
        {r.tp.numero} – {r.tp.objeto}
      </h2>
      <p>{r.atualizadoEm ? TEXTOS_DESPESAS.ATUALIZADO(dataBrasilia(r.atualizadoEm)) : TEXTOS_DESPESAS.SEM_ATUALIZACAO}</p>
      {r.pendencias.quantidade > 0 && <p role="note">{TEXTOS_DESPESAS.PENDENCIAS(r.pendencias.quantidade, moeda(r.pendencias.valor))}</p>}
      {r.ajustes > 0 && <p role="note">{TEXTOS_DESPESAS.AJUSTES(r.ajustes)}</p>}
      {r.linhas.length === 0 ? (
        <p>{VAZIO}</p>
      ) : (
        <div role="region" aria-label="Demonstrativo de despesas com viagens" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption>Despesas com viagens e diárias realizadas por conta</caption>
            <thead>
              <tr>
                <th scope="col">Conta</th>
                <th scope="col">Descrição</th>
                {r.colunas.map((c, i) => (
                  <th key={i} scope="col">
                    {c.rotulo}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.linhas.map((l) => (
                <tr key={l.classificacao}>
                  <th scope="row">{l.classificacao}</th>
                  <td style={{ paddingLeft: `${l.nivel * 1.25}em` }}>
                    {l.analitica ? l.descricao : <strong>{l.descricao}</strong>}
                    {l.inativa && ` ${TEXTOS_DESPESAS.INATIVA}`}
                  </td>
                  {l.valores.map((v, i) => (
                    <td key={i} style={DIREITA}>
                      {moeda(v)}
                    </td>
                  ))}
                  <td style={DIREITA}>{moeda(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {TOTAL_GERAL}
                </th>
                {r.totalGeral.valores.map((v, i) => (
                  <td key={i} style={DIREITA}>
                    {moeda(v)}
                  </td>
                ))}
                <td style={DIREITA}>{moeda(r.totalGeral.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
