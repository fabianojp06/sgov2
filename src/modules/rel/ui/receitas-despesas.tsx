import { Dinheiro } from '@/shared/kernel';
import type { TelaReceitasDespesas } from '../application/receitas-despesas';
import type { Prs } from '../application/receitas-despesas-montagem';
import { TEXTOS_DESPESAS } from './despesas-tp';

// Demonstrativo de receitas e despesas sintético do TP (US-096 parte 2; UC05.01): o título do TP (RN0238), a 1ª
// tabela (cronograma de desembolso, RN0386) e a 2ª (previsto, realizado e saldo acumulado por conta, REQ0248),
// com o total geral (REQ0252). Os avisos dizem de onde vem o previsto e o que ficou de fora. Componente puro.

export const TEXTOS_RECEITAS_DESPESAS = {
  VERSAO: (v: number) => `Previsto da versão oficializada ${v} (cronograma de desembolso).`,
  SEM_VERSAO: 'O TP não tem versão oficializada: o previsto sai zerado.',
  SEM_PESSOAL: 'O custo do pessoal homologado não entra no previsto do seu perfil.',
  PESSOAL_NAO_HOMOLOGADO: 'O lote de pessoal da versão oficial ainda não foi homologado: o pessoal não entra no previsto.',
  FORA_PREVISTO: (n: number, v: string) => `${n} valor(es) do previsto em conta que não é analítica de despesa, somando ${v}, estão só no cronograma.`,
  TERCEIRA_TABELA: 'As parcelas recebidas, os rendimentos e o saldo disponível (3ª tabela) entram com as aplicações financeiras.',
} as const;

const dataBrasilia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const moeda = (v: string) => Dinheiro.de(v).formatar();
const DIREITA = { textAlign: 'right' } as const;
const SUB = ['Previsto', 'Realizado', 'Saldo'] as const;

function Tres({ v }: { v: Prs }) {
  return (
    <>
      <td style={DIREITA}>{moeda(v.previsto)}</td>
      <td style={DIREITA}>{moeda(v.realizado)}</td>
      <td style={DIREITA}>{moeda(v.saldo)}</td>
    </>
  );
}

export function TabelaReceitasDespesas({ relatorio: r }: { relatorio: NonNullable<TelaReceitasDespesas['relatorio']> }) {
  const periodos = [...r.colunas.map((c) => c.rotulo), 'Total'];
  return (
    <section aria-labelledby="receitas-despesas-titulo">
      <h2 id="receitas-despesas-titulo">
        {r.tp.numero} – {r.tp.objeto}
      </h2>
      <p>{r.versaoPrevisto === null ? TEXTOS_RECEITAS_DESPESAS.SEM_VERSAO : TEXTOS_RECEITAS_DESPESAS.VERSAO(r.versaoPrevisto)}</p>
      <p>{r.atualizadoEm ? TEXTOS_DESPESAS.ATUALIZADO(dataBrasilia(r.atualizadoEm)) : TEXTOS_DESPESAS.SEM_ATUALIZACAO}</p>
      {r.previstoSemPessoal && <p role="note">{TEXTOS_RECEITAS_DESPESAS.SEM_PESSOAL}</p>}
      {r.pessoalNaoHomologado && <p role="note">{TEXTOS_RECEITAS_DESPESAS.PESSOAL_NAO_HOMOLOGADO}</p>}
      {r.pendencias.quantidade > 0 && <p role="note">{TEXTOS_DESPESAS.PENDENCIAS(r.pendencias.quantidade, moeda(r.pendencias.valor))}</p>}
      {r.ajustes > 0 && <p role="note">{TEXTOS_DESPESAS.AJUSTES(r.ajustes)}</p>}
      {r.foraDaArvore.realizado.quantidade > 0 && <p role="note">{TEXTOS_DESPESAS.FORA(r.foraDaArvore.realizado.quantidade, moeda(r.foraDaArvore.realizado.valor))}</p>}
      {r.foraDaArvore.previsto.quantidade > 0 && <p role="note">{TEXTOS_RECEITAS_DESPESAS.FORA_PREVISTO(r.foraDaArvore.previsto.quantidade, moeda(r.foraDaArvore.previsto.valor))}</p>}

      <div role="region" aria-label="Cronograma de desembolso" tabIndex={0} style={{ overflowX: 'auto' }}>
        <table>
          <caption>Cronograma de desembolso</caption>
          <thead>
            <tr>
              <th scope="col">Total do período</th>
              {r.colunas.map((c, i) => (
                <th key={i} scope="col">
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={DIREITA}>{moeda(r.cronograma.total)}</td>
              {r.cronograma.valores.map((v, i) => (
                <td key={i} style={DIREITA}>
                  {moeda(v)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div role="region" aria-label="Previsto, realizado e saldo por conta" tabIndex={0} style={{ overflowX: 'auto' }}>
        <table>
          <caption>Despesas do Termo de Parceria: previsto, realizado e saldo acumulado</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Conta
              </th>
              <th scope="col" rowSpan={2}>
                Elementos de despesa
              </th>
              {periodos.map((p, i) => (
                <th key={i} scope="colgroup" colSpan={3}>
                  {p}
                </th>
              ))}
            </tr>
            <tr>
              {periodos.flatMap((_, i) =>
                SUB.map((s) => (
                  <th key={`${i}-${s}`} scope="col">
                    {s}
                  </th>
                )),
              )}
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
                  <Tres key={i} v={v} />
                ))}
                <Tres v={l.total} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {TEXTOS_DESPESAS.TOTAL_GERAL}
              </th>
              {r.totalGeral.valores.map((v, i) => (
                <Tres key={i} v={v} />
              ))}
              <Tres v={r.totalGeral.total} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p>{TEXTOS_RECEITAS_DESPESAS.TERCEIRA_TABELA}</p>
    </section>
  );
}
