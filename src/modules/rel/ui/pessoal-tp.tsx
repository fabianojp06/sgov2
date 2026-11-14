import { Dinheiro } from '@/shared/kernel';
import type { TelaPessoal } from '../application/pessoal-tp';

// Relatórios de pessoal do TP (US-098; UC05.05 e UC05.06): o título do TP, a origem (o previsto da versão oficial,
// #120), a tabela e o total de empregados (REQ0332/0338). O custo mensal previsto só aparece para quem vê o custo do
// pessoal. Componentes puros.

export const TEXTOS_PESSOAL = {
  ORIGEM: (v: number) => `Previsto na versão oficializada ${v} da proposta (não é a folha de pagamento).`,
  TOTAL: (n: number) => `Total de empregados: ${n}`,
  VAZIO: 'Nenhum empregado no período com esses filtros.',
  SEM_CUSTO: 'O seu perfil não vê o custo do pessoal (só quem lança os empregados vê).',
  NAO_HOMOLOGADO: 'O lote de pessoal da versão oficial ainda não foi homologado: os empregados podem mudar.',
} as const;

type Relatorio = NonNullable<TelaPessoal['relatorio']>;
const moeda = (v: string) => Dinheiro.de(v).formatar();
const DIREITA = { textAlign: 'right' } as const;
const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

function Cabecalho({ r, id }: { r: Relatorio; id: string }) {
  return (
    <>
      <h2 id={id}>
        {r.tp.numero} – {r.tp.objeto}
      </h2>
      <p>{TEXTOS_PESSOAL.ORIGEM(r.versao)}</p>
      {!r.homologado && <p role="note">{TEXTOS_PESSOAL.NAO_HOMOLOGADO}</p>}
      <p role="status">{TEXTOS_PESSOAL.TOTAL(r.linhas.length)}</p>
    </>
  );
}

export function TabelaSalarios({ relatorio: r }: { relatorio: Relatorio }) {
  const veCusto = r.totalCustos !== null;
  return (
    <section aria-labelledby="salarios-titulo">
      <Cabecalho r={r} id="salarios-titulo" />
      {!veCusto && <p role="note">{TEXTOS_PESSOAL.SEM_CUSTO}</p>}
      {r.linhas.length === 0 ? (
        <p>{TEXTOS_PESSOAL.VAZIO}</p>
      ) : (
        <div role="region" aria-label="Salários dos empregados" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption>Empregados do Termo de Parceria e custo mensal previsto</caption>
            <thead>
              <tr>
                <th scope="col">Seq</th>
                <th scope="col">Nome</th>
                <th scope="col">Cargo</th>
                <th scope="col">Categoria</th>
                {r.porMeta && <th scope="col">Meta</th>}
                <th scope="col">Início</th>
                <th scope="col">Fim</th>
                {veCusto && <th scope="col">Custo mensal previsto</th>}
              </tr>
            </thead>
            <tbody>
              {r.linhas.map((l) => (
                <tr key={l.seq}>
                  <td>{l.seq}</td>
                  <th scope="row">{l.nome}</th>
                  <td>{l.cargo}</td>
                  <td>{l.categoria}</td>
                  {r.porMeta && <td>{l.meta ?? '—'}</td>}
                  <td>{mes(l.inicio)}</td>
                  <td>{mes(l.fim)}</td>
                  {veCusto && <td style={DIREITA}>{moeda(l.custo ?? '0')}</td>}
                </tr>
              ))}
            </tbody>
            {veCusto && (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={r.porMeta ? 7 : 6}>
                    Total do custo mensal previsto
                  </th>
                  <td style={DIREITA}>{moeda(r.totalCustos!)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

export function TabelaDistribuicao({ relatorio: r }: { relatorio: Relatorio }) {
  return (
    <section aria-labelledby="distribuicao-titulo">
      <Cabecalho r={r} id="distribuicao-titulo" />
      {r.linhas.length === 0 ? (
        <p>{TEXTOS_PESSOAL.VAZIO}</p>
      ) : (
        <div role="region" aria-label="Distribuição de pessoal por setor" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption>Distribuição de pessoal por setor</caption>
            <thead>
              <tr>
                <th scope="col">Seq</th>
                <th scope="col">Setor / Nome</th>
                <th scope="col">Cargo</th>
                <th scope="col">Categoria</th>
                {r.porMeta && <th scope="col">Meta</th>}
              </tr>
            </thead>
            {r.grupos.map((g) => (
              <tbody key={g.setor}>
                <tr>
                  <th scope="rowgroup" colSpan={r.porMeta ? 5 : 4} style={{ textAlign: 'left' }}>
                    {g.setor}: {g.linhas.length} empregado(s)
                  </th>
                </tr>
                {g.linhas.map((l) => (
                  <tr key={l.seq}>
                    <td>{l.seq}</td>
                    <th scope="row" style={{ paddingLeft: '1.25em', fontWeight: 'normal' }}>
                      {l.nome}
                    </th>
                    <td>{l.cargo}</td>
                    <td>{l.categoria}</td>
                    {r.porMeta && <td>{l.meta ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}
