import { Dinheiro } from '@/shared/kernel';
import type { TelaDespesas } from '../application/despesas-tp';

// Demonstrativo de despesas do TP (US-096 parte 1; UC05.02): a tabela com o título do TP (RN0238), as colunas
// do período, as contas com recuo pela hierarquia (REQ0261), as sintéticas em negrito e o total geral (RN0267).
// Componente puro (sem estado).

export const TEXTOS_DESPESAS = {
  TOTAL_GERAL: 'Total Geral Termo de Parceria',
  ATUALIZADO: (d: string) => `Realizado atualizado em ${d}.`,
  SEM_ATUALIZACAO: 'Ainda não há carga do realizado para este TP.',
  PENDENCIAS: (n: number, v: string) => `${n} lançamento(s) em conta desconhecida, somando ${v}, ficaram fora do demonstrativo (pendências da carga).`,
  AJUSTES: (n: number) => `${n} ajuste(s) de meses fechados já estão somados nos meses em que foram lançados.`,
  VAZIO: 'Nenhuma despesa realizada no período. Marque "Exibir contas zeradas" para ver o plano inteiro.',
  FORA: (n: number, v: string) => `${n} lançamento(s) em conta que não é analítica de despesa, somando ${v}, ficaram fora do total.`,
  INATIVA: '(inativa)',
} as const;

const dataBrasilia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const moeda = (v: string) => Dinheiro.de(v).formatar();
const DIREITA = { textAlign: 'right' } as const;

export function TabelaDespesas({ relatorio: r }: { relatorio: NonNullable<TelaDespesas['relatorio']> }) {
  return (
    <section aria-labelledby="despesas-titulo">
      <h2 id="despesas-titulo">
        {r.tp.numero} – {r.tp.objeto}
      </h2>
      <p>{r.atualizadoEm ? TEXTOS_DESPESAS.ATUALIZADO(dataBrasilia(r.atualizadoEm)) : TEXTOS_DESPESAS.SEM_ATUALIZACAO}</p>
      {r.pendencias.quantidade > 0 && <p role="note">{TEXTOS_DESPESAS.PENDENCIAS(r.pendencias.quantidade, moeda(r.pendencias.valor))}</p>}
      {r.ajustes > 0 && <p role="note">{TEXTOS_DESPESAS.AJUSTES(r.ajustes)}</p>}
      {r.foraDaArvore.quantidade > 0 && <p role="note">{TEXTOS_DESPESAS.FORA(r.foraDaArvore.quantidade, moeda(r.foraDaArvore.valor))}</p>}
      {r.linhas.length === 0 ? (
        <p>{TEXTOS_DESPESAS.VAZIO}</p>
      ) : (
        <div role="region" aria-label="Demonstrativo de despesas" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption>Despesas realizadas por conta</caption>
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
                  {TEXTOS_DESPESAS.TOTAL_GERAL}
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
