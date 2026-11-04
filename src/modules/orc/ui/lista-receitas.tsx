import { Dinheiro } from "@/shared/kernel";
import { valorParaTela } from "../domain/valor-tela";
import { AcaoConfirmada, type AcaoFormulario } from "@/modules/ger";

// Receitas do rateio dos TPs no exercício (US-060; C35). Confirmadas e previstas em tabelas
// separadas (a prevista fica fora do saldo e do teto); cada linha com o selo de digitada na
// transição; ISS "a definir" (GAP-ORC-007) e líquido igual ao rateio. Server Component.
export const SELO_TRANSICAO = "Digitado na transição";
const MESES = [
  ["Jan", "Janeiro"],
  ["Fev", "Fevereiro"],
  ["Mar", "Março"],
  ["Abr", "Abril"],
  ["Mai", "Maio"],
  ["Jun", "Junho"],
  ["Jul", "Julho"],
  ["Ago", "Agosto"],
  ["Set", "Setembro"],
  ["Out", "Outubro"],
  ["Nov", "Novembro"],
  ["Dez", "Dezembro"],
] as const;

type Receita = {
  id: string;
  tp: string;
  descricao: string;
  meses: readonly Dinheiro[];
  total: Dinheiro;
  liquido: Dinheiro;
  versao: number;
};
type Permissoes = {
  podeIncluir: boolean;
  podeAlterar: boolean;
  podeExcluir: boolean;
};

const AVISOS: Readonly<Record<string, string>> = {
  incluida: "Receita incluída.",
  alterada: "Receita alterada.",
  excluida: "Receita excluída.",
};
export const textoAvisoReceita = (aviso: string | undefined) =>
  aviso !== undefined && Object.hasOwn(AVISOS, aviso)
    ? AVISOS[aviso]
    : undefined;

function Tabela({
  titulo,
  vazio,
  receitas,
  totalMes,
  editavel,
  permissoes,
  excluir,
}: {
  titulo: string;
  vazio: string;
  receitas: readonly Receita[];
  totalMes: readonly Dinheiro[];
  editavel: boolean;
  permissoes: Permissoes;
  excluir: AcaoFormulario;
}) {
  const acoes = editavel && (permissoes.podeAlterar || permissoes.podeExcluir);
  const idCaption = `receitas-${titulo.toLowerCase()}`;
  const totalAno = Dinheiro.somarTodos(totalMes);
  return (
    <section>
      <h2>{titulo}</h2>
      {receitas.length === 0 ? (
        <p>{vazio}</p>
      ) : (
        // Tabela larga (17 colunas): região rolável e focável, para não rolar a página inteira.
        <div role="region" aria-labelledby={idCaption} tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption
              id={idCaption}
            >{`Receitas ${titulo.toLowerCase()} (rateio dos TPs), mês a mês, em R$`}</caption>
            <thead>
              <tr>
                <th scope="col">TP / versão</th>
                <th scope="col">Descrição</th>
                {MESES.map(([abreviado, mes]) => (
                  <th key={abreviado} scope="col">
                    <abbr title={mes}>{abreviado}</abbr>
                  </th>
                ))}
                <th scope="col">Total do rateio</th>
                <th scope="col">ISS sobre o rateio</th>
                <th scope="col">Rateio líquido</th>
                {acoes && <th scope="col">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {receitas.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    {r.tp} <span className="selo">{SELO_TRANSICAO}</span>
                  </th>
                  <td>{r.descricao}</td>
                  {r.meses.map((m, i) => (
                    <td key={i}>{valorParaTela(m)}</td>
                  ))}
                  <td>{valorParaTela(r.total)}</td>
                  <td>a definir</td>
                  <td>{valorParaTela(r.liquido)}</td>
                  {acoes && (
                    <td>
                      {permissoes.podeAlterar && (
                        <a
                          href={`/orc/receitas/${r.id}`}
                        >{`Alterar ${r.tp}`}</a>
                      )}
                      {permissoes.podeExcluir && (
                        <AcaoConfirmada
                          rotulo={`Excluir ${r.tp}`}
                          pergunta={`Deseja realmente excluir a receita do TP ${r.tp}?`}
                          acao={excluir}
                          campos={{ id: r.id, versao: String(r.versao) }}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total por mês
                </th>
                {totalMes.map((m, i) => (
                  <td key={i}>{valorParaTela(m)}</td>
                ))}
                <td>{valorParaTela(totalAno)}</td>
                <td>a definir</td>
                <td>{valorParaTela(totalAno)}</td>
                {acoes && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export function ListaReceitas({
  ano,
  confirmadas,
  previstas,
  totalConfirmadoMes,
  totalPrevistoMes,
  editavel,
  permissoes,
  excluir,
  aviso,
}: {
  ano: number;
  confirmadas: readonly Receita[];
  previstas: readonly Receita[];
  totalConfirmadoMes: readonly Dinheiro[];
  totalPrevistoMes: readonly Dinheiro[];
  editavel: boolean;
  permissoes: Permissoes;
  excluir: AcaoFormulario;
  aviso?: string | undefined;
}) {
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {editavel && permissoes.podeIncluir && (
        <a href={`/orc/receitas/novo?ano=${ano}`}>Nova receita</a>
      )}
      <Tabela
        titulo="Confirmadas"
        vazio="Nenhuma receita confirmada."
        receitas={confirmadas}
        totalMes={totalConfirmadoMes}
        editavel={editavel}
        permissoes={permissoes}
        excluir={excluir}
      />
      <Tabela
        titulo="Previstas"
        vazio="Nenhuma receita prevista."
        receitas={previstas}
        totalMes={totalPrevistoMes}
        editavel={editavel}
        permissoes={permissoes}
        excluir={excluir}
      />
      <p>Receita prevista não entra no saldo nem no teto.</p>
    </>
  );
}
