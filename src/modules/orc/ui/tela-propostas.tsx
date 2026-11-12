import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { CcLivreTp, PropostaTela } from '../application/propostas';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { LIMITE_NUMERO_TP, ROTULO_CATEGORIA_PROPOSTA, ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';
import { FormProposta } from './form-proposta';

// Tela das propostas de TP (US-065, UC 3.04, 3.05 e 3.07; plano do P17, Task 2). Server Component: a
// lista das propostas dos TPs do usuário (a RLS já filtra), com o selo da situação e o Valor Global
// calculado; "Excluir" só em Rascunho e com orc.propostas:excluir; e o formulário "Nova proposta" só
// com orc.propostas:incluir. Sem CC de TP livre, a mensagem no lugar do formulário.

/** AAAA-MM-DD → dd/mm/aaaa (sem Date: a data é civil e não pode mudar de dia pelo fuso). */
const dataParaTela = (v: string) => {
  const [ano, mes, dia] = v.split('-');
  return `${dia}/${mes}/${ano}`;
};

/** Aviso depois de criar ou excluir, com o número do TP vindo da ação (?tp=). */
export function textoAvisoProposta(aviso: string | undefined, tp: string | undefined): string | undefined {
  if (!tp || [...tp].length > LIMITE_NUMERO_TP) return undefined;
  if (aviso === 'incluida') return MENSAGENS_ORC.PROPOSTA_CRIADA(tp);
  if (aviso === 'excluida') return MENSAGENS_ORC.PROPOSTA_EXCLUIDA(tp);
  return undefined;
}

export type PermissoesProposta = { podeIncluir: boolean; podeExcluir: boolean };

export function TelaPropostas({
  propostas,
  ccsLivres,
  permissoes,
  acoes,
  aviso,
}: {
  propostas: readonly PropostaTela[];
  /** CCs de TP livres; nulo sem orc.propostas:incluir (a página nem os lê). */
  ccsLivres: readonly CcLivreTp[] | null;
  permissoes: PermissoesProposta;
  acoes: { criar: AcaoFormulario; excluir: AcaoFormulario };
  aviso?: string | undefined;
}) {
  const acoesNaLinha = permissoes.podeExcluir && propostas.some((p) => p.situacao === 'RASCUNHO');
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {propostas.length === 0 ? (
        <p>Nenhuma proposta nos seus Termos de Parceria.</p>
      ) : (
        <div role="region" aria-labelledby="propostas-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption id="propostas-caption">Propostas dos seus Termos de Parceria, valores em R$</caption>
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Tipo</th>
                <th scope="col">Objeto</th>
                <th scope="col">Categoria</th>
                <th scope="col">Vigência</th>
                <th scope="col">CC</th>
                <th scope="col">Situação</th>
                <th scope="col">Valor global</th>
                {acoesNaLinha && <th scope="col">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {propostas.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.numero}</th>
                  <td>{ROTULO_TIPO_PROPOSTA[p.tipo]}</td>
                  <td>{p.objeto}</td>
                  <td>{ROTULO_CATEGORIA_PROPOSTA[p.categoria]}</td>
                  <td>{`${dataParaTela(p.inicio)} a ${dataParaTela(p.fim)}`}</td>
                  <td>{p.cc ?? ''}</td>
                  <td>
                    <span className="selo">{ROTULO_SITUACAO_PROPOSTA[p.situacao]}</span>
                  </td>
                  <td>{valorParaTela(p.valorGlobal)}</td>
                  {acoesNaLinha && (
                    <td>
                      {p.situacao === 'RASCUNHO' && (
                        <AcaoConfirmada
                          rotulo={`Excluir a proposta ${p.numero}`}
                          pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_PROPOSTA}
                          acao={acoes.excluir}
                          campos={{ id: p.id, versao: String(p.versao) }}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {permissoes.podeIncluir &&
        ccsLivres !== null &&
        (ccsLivres.length === 0 ? <p role="note">{MENSAGENS_ORC.SEM_CC_LIVRE_TP}</p> : <FormProposta ccs={ccsLivres} salvar={acoes.criar} />)}
    </>
  );
}
