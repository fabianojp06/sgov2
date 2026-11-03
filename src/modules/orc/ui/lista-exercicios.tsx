import { AcaoConfirmada, type AcaoFormulario } from './acao-confirmada';

// Exercícios do orçamento da Adm. Central (US-055). O botão Avançar só aparece em Rascunho, para
// quem pode alterar; Novo exercício, para quem pode incluir.
type ItemLista = { id: string; ano: number; situacao: string; rotuloSituacao: string; versao: number };

// Avisos pós-redirect: a URL leva só o código (e a contagem numérica), nunca texto livre.
export function textoAviso(aviso: string | undefined, puladas: number): string | undefined {
  if (aviso === 'criado') return 'Exercício criado.';
  if (aviso === 'copiado') {
    return puladas > 0
      ? `Exercício criado copiando o anterior. ${puladas} lançamento(s) não foram copiados porque o CC ou a conta estão inativos.`
      : 'Exercício criado copiando o anterior.';
  }
  if (aviso === 'avancado') return 'Exercício em elaboração.';
  return undefined;
}

export function ListaExercicios({
  exercicios,
  podeIncluir,
  podeAlterar,
  avancar,
  aviso,
}: {
  exercicios: readonly ItemLista[];
  podeIncluir: boolean;
  podeAlterar: boolean;
  avancar: AcaoFormulario;
  aviso?: string | undefined;
}) {
  return (
    <main>
      <h1>Exercícios</h1>
      {aviso && <p role="status">{aviso}</p>}
      {podeIncluir && <a href="/orc/exercicios/novo">Novo exercício</a>}
      {exercicios.length === 0 ? (
        <p>Nenhum exercício cadastrado.</p>
      ) : (
        <table>
          <caption>Exercícios do orçamento da Adm. Central</caption>
          <thead>
            <tr>
              <th scope="col">Ano</th>
              <th scope="col">Situação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {exercicios.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.ano}</th>
                <td>{e.rotuloSituacao}</td>
                <td>
                  {podeAlterar && e.situacao === 'RASCUNHO' && (
                    <AcaoConfirmada
                      rotulo={`Avançar ${e.ano} para Em Elaboração`}
                      pergunta={`Deseja realmente avançar o exercício ${e.ano} para Em Elaboração?`}
                      acao={avancar}
                      campos={{ id: e.id, versao: String(e.versao) }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
