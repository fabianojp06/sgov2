import type { AcaoFormulario } from '@/modules/ger';
import { Dinheiro } from '@/shared/kernel';
import type { ListaCorrespondencia } from '../application/correspondencia-cargos';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';
import { LigarCargo } from './ligar-cargo';

// Tela de correspondência do cargo em texto com o cadastro de C&S (US-056, #410; plano do P16, Task 2).
// Server Component: uma linha por texto exato das posições sem cargo, com as posições, os CCs e o salário
// gravado (quem chega aqui altera posição e vê o salário, D-P12-3), e a escolha do cargo na linha.
const faixa = (minimo: string, maximo: string) =>
  minimo === maximo ? valorParaTela(Dinheiro.de(minimo)) : `${valorParaTela(Dinheiro.de(minimo))} a ${valorParaTela(Dinheiro.de(maximo))}`;

export function TelaCorrespondencia({
  ano,
  exercicioId,
  lista,
  acao,
  aviso,
}: {
  ano: number;
  exercicioId: string;
  lista: ListaCorrespondencia;
  acao: AcaoFormulario;
  aviso?: string | undefined;
}) {
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      <p>
        Ligue cada cargo em texto das posições ao cargo do cadastro de Cargos e Salários. Todas as posições com aquele texto passam a usar o cargo escolhido; o salário gravado não muda.
      </p>
      {!lista.editavel ? (
        <p>{MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(lista.rotuloSituacao)}</p>
      ) : lista.itens.length === 0 ? (
        <p>{MENSAGENS_ORC.CORRESPONDENCIA_VAZIA}</p>
      ) : (
        <>
          {lista.cargos.cargos.length === 0 && <p>{MENSAGENS_ORC.CORRESPONDENCIA_SEM_CARGOS}</p>}
          {!lista.cargos.comSalario && lista.cargos.cargos.length > 0 && <p role="note">{MENSAGENS_ORC.CORRESPONDENCIA_SEM_FONTE_ATIVA}</p>}
          <div role="region" aria-labelledby="correspondencia-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
            <table>
              <caption id="correspondencia-caption">{`Cargos em texto das posições de ${ano}, salários em R$`}</caption>
              <thead>
                <tr>
                  <th scope="col">Cargo em texto</th>
                  <th scope="col">Posições</th>
                  <th scope="col">CCs</th>
                  <th scope="col">Salário gravado</th>
                  <th scope="col">Cargo do cadastro</th>
                </tr>
              </thead>
              <tbody>
                {lista.itens.map((item) => (
                  <tr key={item.texto}>
                    <th scope="row">{item.texto}</th>
                    <td>{item.posicoes}</td>
                    <td>{item.ccs}</td>
                    <td>{faixa(item.salarioMinimo, item.salarioMaximo)}</td>
                    <td>
                      {lista.cargos.cargos.length > 0 && <LigarCargo item={item} exercicioId={exercicioId} versao={lista.versao} cargos={lista.cargos} acao={acao} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p>
        <a href={`/orc/posicoes?ano=${ano}`}>Voltar às posições de pessoal</a>
      </p>
    </>
  );
}
