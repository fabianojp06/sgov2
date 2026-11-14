import { Dinheiro } from '@/shared/kernel';
import type { TelaAquisicoes } from '../application/aquisicoes-tp';
import { TEXTOS_DESPESAS } from './despesas-tp';

// Demonstrativo de aquisições do TP (US-097 parte 2; UC05.04): o título do TP, de onde vem o previsto, cada conta do
// Imobilizado/Intangível em negrito com o previsto por coluna, o total e o realizado e, abaixo, os bens com data,
// quantidade, valor unitário e o total na coluna do mês (RN0412/0414). Componente puro.

export const TEXTOS_AQUISICOES = {
  VERSAO: (v: number) => `Previsto: os bens da versão oficializada ${v} (cadastro de bens da proposta). Realizado: a execução da conta no período.`,
  SEM_VERSAO: 'O TP não tem versão oficializada: sem bens previstos.',
  VAZIO: 'Nenhuma aquisição prevista ou realizada no período com esses filtros.',
  FORA: (n: number, v: string) => `${n} bem(ns) do período em conta fora do Imobilizado/Intangível, somando ${v}, ficaram fora do total.`,
  TOTAL_GERAL: 'Total Geral de Aquisições',
} as const;

const dataBrasilia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const moeda = (v: string) => Dinheiro.de(v).formatar();
const DIREITA = { textAlign: 'right' } as const;
const data = (d: string) => d.split('-').reverse().join('/');

export function TabelaAquisicoes({ relatorio: r }: { relatorio: NonNullable<TelaAquisicoes['relatorio']> }) {
  return (
    <section aria-labelledby="aquisicoes-titulo">
      <h2 id="aquisicoes-titulo">
        {r.tp.numero} – {r.tp.objeto}
      </h2>
      <p>{r.versao === null ? TEXTOS_AQUISICOES.SEM_VERSAO : TEXTOS_AQUISICOES.VERSAO(r.versao)}</p>
      <p>{r.atualizadoEm ? TEXTOS_DESPESAS.ATUALIZADO(dataBrasilia(r.atualizadoEm)) : TEXTOS_DESPESAS.SEM_ATUALIZACAO}</p>
      {r.foraDasContas.quantidade > 0 && <p role="note">{TEXTOS_AQUISICOES.FORA(r.foraDasContas.quantidade, moeda(r.foraDasContas.valor))}</p>}
      {r.contas.length === 0 ? (
        <p>{TEXTOS_AQUISICOES.VAZIO}</p>
      ) : (
        <div role="region" aria-label="Demonstrativo de aquisições" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption>Aquisições por conta do Imobilizado/Intangível: bens previstos e realizado</caption>
            <thead>
              <tr>
                <th scope="col">Conta</th>
                <th scope="col">Descrição</th>
                <th scope="col">Data</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Valor unitário</th>
                {r.colunas.map((c, i) => (
                  <th key={i} scope="col">
                    {c.rotulo}
                  </th>
                ))}
                <th scope="col">Total previsto</th>
                <th scope="col">Realizado</th>
              </tr>
            </thead>
            {r.contas.map((c) => (
              <tbody key={c.classificacao}>
                <tr>
                  <th scope="row">{c.classificacao}</th>
                  <td colSpan={4}>
                    <strong>{c.descricao}</strong>
                    {c.inativa && ` ${TEXTOS_DESPESAS.INATIVA}`}
                  </td>
                  {c.valores.map((v, i) => (
                    <td key={i} style={DIREITA}>
                      {moeda(v)}
                    </td>
                  ))}
                  <td style={DIREITA}>{moeda(c.total)}</td>
                  <td style={DIREITA}>{moeda(c.realizado)}</td>
                </tr>
                {c.itens.map((i, k) => (
                  <tr key={k}>
                    <td />
                    <td style={{ paddingLeft: '1.25em' }}>{i.descricao}</td>
                    <td>{data(i.data)}</td>
                    <td style={DIREITA}>{i.quantidade}</td>
                    <td style={DIREITA}>{moeda(i.valorUnitario)}</td>
                    {r.colunas.map((_, j) => (
                      <td key={j} style={DIREITA}>
                        {moeda(j === i.coluna ? i.valorTotal : '0')}
                      </td>
                    ))}
                    <td style={DIREITA}>{moeda(i.valorTotal)}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>
                  {TEXTOS_AQUISICOES.TOTAL_GERAL}
                </th>
                {r.totalGeral.valores.map((v, i) => (
                  <td key={i} style={DIREITA}>
                    {moeda(v)}
                  </td>
                ))}
                <td style={DIREITA}>{moeda(r.totalGeral.total)}</td>
                <td style={DIREITA}>{moeda(r.totalGeral.realizado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
