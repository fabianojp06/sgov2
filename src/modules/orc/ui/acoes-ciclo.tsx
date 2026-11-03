import { MENSAGENS_ORC } from '../domain/mensagens';
import { AcaoConfirmada, type AcaoFormulario } from './acao-confirmada';
import { FormRejeicao } from './form-rejeicao';

// Envio e aprovação do orçamento da Adm. Central (US-061; C36). A GFIN envia (Em Elaboração); a
// DIREX aprova ou rejeita (Em Aprovação). Oficializado: só a data, sem botões. Server Component.
type Tramite = { de: string; para: string; usuario: string; justificativa: string | null; em: Date };

const dataHora = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);

export function AcoesCiclo({
  exercicio,
  tramites,
  podeEnviar,
  podeAprovar,
  enviar,
  aprovar,
  rejeitar,
  aviso,
}: {
  exercicio: { id: string; ano: number; situacao: string; rotuloSituacao: string; versao: number; oficializadoEm: Date | null };
  tramites: readonly Tramite[];
  podeEnviar: boolean;
  podeAprovar: boolean;
  enviar: AcaoFormulario;
  aprovar: AcaoFormulario;
  rejeitar: AcaoFormulario;
  aviso?: string | undefined;
}) {
  const campos = { id: exercicio.id, versao: String(exercicio.versao) };
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      <p>{`Situação: ${exercicio.rotuloSituacao}`}</p>
      {exercicio.situacao === 'OFICIALIZADO' && exercicio.oficializadoEm && <p>{`Oficializado em ${dataHora(exercicio.oficializadoEm)}`}</p>}
      {exercicio.situacao === 'EM_ELABORACAO' && podeEnviar && (
        <AcaoConfirmada rotulo="Enviar para aprovação" pergunta={MENSAGENS_ORC.CONFIRMA_ENVIO(exercicio.ano)} acao={enviar} campos={campos} />
      )}
      {exercicio.situacao === 'EM_APROVACAO' && podeAprovar && (
        <>
          <AcaoConfirmada rotulo="Aprovar" pergunta={MENSAGENS_ORC.CONFIRMA_APROVACAO(exercicio.ano)} acao={aprovar} campos={campos} />
          <FormRejeicao id={exercicio.id} versao={exercicio.versao} rejeitar={rejeitar} />
        </>
      )}
      <section aria-labelledby="tramites">
        <h2 id="tramites">Histórico do ciclo</h2>
        {tramites.length === 0 ? (
          <p>Nenhum trâmite ainda.</p>
        ) : (
          <table>
            <caption>Trâmites do orçamento</caption>
            <thead>
              <tr>
                <th scope="col">De</th>
                <th scope="col">Para</th>
                <th scope="col">Usuário</th>
                <th scope="col">Justificativa</th>
                <th scope="col">Data</th>
              </tr>
            </thead>
            <tbody>
              {tramites.map((t, i) => (
                <tr key={i}>
                  <td>{t.de}</td>
                  <th scope="row">{t.para}</th>
                  <td>{t.usuario}</td>
                  <td>{t.justificativa ?? ''}</td>
                  <td>{dataHora(t.em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
