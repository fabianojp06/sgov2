import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { CcLivreTp, DadosDuplicar, PropostaTela } from '../application/propostas';
import { MENSAGENS_ORC } from '../domain/mensagens';
import {
  LIMITE_NUMERO_TP,
  ROTULO_CATEGORIA_PROPOSTA,
  ROTULO_SITUACAO_PROPOSTA,
  ROTULO_TIPO_PROPOSTA,
  SITUACOES_VERSIONAVEIS,
  type SituacaoProposta,
} from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';
import { FormDuplicarProposta } from './form-duplicar-proposta';
import { FormProposta } from './form-proposta';

// Tela das propostas de TP (US-065, UC 3.04, 3.05 e 3.07; plano do P17, Task 2). Server Component: a
// lista das propostas dos TPs do usuário (a RLS já filtra), com o selo da situação e o Valor Global
// calculado; "Excluir" só em Rascunho e com orc.propostas:excluir; e o formulário "Nova proposta" só
// com orc.propostas:incluir. Sem CC de TP livre, a mensagem no lugar do formulário.
// Duplicar e nova versão (US-066; plano do P18, Task 2), com orc.propostas:incluir (D-P18-6): a coluna
// Versão mostra a última; "Nova versão" (com confirmação) só quando a última está em Rascunho ou Em
// Elaboração (D-P18-1); "Duplicar" é um link para ?duplicar=<id>, que troca o "Nova proposta" pelo
// formulário de duplicar. "Excluir" e "Nova versão" agem sobre a última versão, com a versão da capa.
// Na proposta de categoria Meta, o link para as metas dela, com orc.metas:consultar (US-067; plano do P19).

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
  if (aviso === 'duplicada') return MENSAGENS_ORC.PROPOSTA_DUPLICADA(tp);
  if (aviso === 'versao') return MENSAGENS_ORC.VERSAO_CRIADA(tp);
  return undefined;
}

const versionavel = (s: SituacaoProposta) => (SITUACOES_VERSIONAVEIS as readonly SituacaoProposta[]).includes(s);

/** O formulário de duplicar aberto (?duplicar=): a origem, ou nulo se o usuário não a vê. */
export type DuplicacaoAberta = { origem: DadosDuplicar | null };

/**
 * podeVerMetas: orc.metas:consultar, para o link das metas na proposta de categoria Meta (US-067).
 * podeVerEmpregados: orc.empregados:consultar, para o link dos empregados em qualquer proposta (US-070).
 * podeVerViagens: orc.viagens:consultar, para o link das viagens em qualquer proposta (US-071).
 * podeVerBens: orc.bens:consultar, para o link dos bens em qualquer proposta (US-072).
 */
export type PermissoesProposta = { podeIncluir: boolean; podeExcluir: boolean; podeVerMetas?: boolean; podeVerEmpregados?: boolean; podeVerViagens?: boolean; podeVerBens?: boolean };

export function TelaPropostas({
  propostas,
  ccsLivres,
  permissoes,
  acoes,
  aviso,
  duplicacao,
}: {
  propostas: readonly PropostaTela[];
  /** CCs de TP livres; nulo sem orc.propostas:incluir (a página nem os lê). */
  ccsLivres: readonly CcLivreTp[] | null;
  permissoes: PermissoesProposta;
  acoes: { criar: AcaoFormulario; excluir: AcaoFormulario; duplicar: AcaoFormulario; novaVersao: AcaoFormulario };
  aviso?: string | undefined;
  /** Só com ?duplicar= e orc.propostas:incluir. */
  duplicacao?: DuplicacaoAberta | null;
}) {
  const podeExcluir = (p: PropostaTela) => permissoes.podeExcluir && p.excluivel;
  const podeVersionar = (p: PropostaTela) => permissoes.podeIncluir && versionavel(p.situacao);
  const verMetas = (p: PropostaTela) => permissoes.podeVerMetas === true && p.categoria === 'META';
  const verEmpregados = permissoes.podeVerEmpregados === true;
  const verViagens = permissoes.podeVerViagens === true;
  const verBens = permissoes.podeVerBens === true;
  const acoesNaLinha = permissoes.podeIncluir || propostas.some(podeExcluir) || propostas.some(verMetas) || ((verEmpregados || verViagens || verBens) && propostas.length > 0);
  const origem = duplicacao?.origem ?? null;
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
                <th scope="col">Versão</th>
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
                  <td>{p.versaoAtual}</td>
                  <td>
                    <span className="selo">{ROTULO_SITUACAO_PROPOSTA[p.situacao]}</span>
                  </td>
                  <td>{valorParaTela(p.valorGlobal)}</td>
                  {acoesNaLinha && (
                    <td>
                      {verMetas(p) && <a href={`/orc/metas?proposta=${encodeURIComponent(p.numero)}`}>{`Metas da proposta ${p.numero}`}</a>}
                      {verEmpregados && <a href={`/orc/empregados?proposta=${encodeURIComponent(p.numero)}`}>{`Empregados da proposta ${p.numero}`}</a>}
                      {verViagens && <a href={`/orc/viagens?proposta=${encodeURIComponent(p.numero)}`}>{`Viagens da proposta ${p.numero}`}</a>}
                      {verBens && <a href={`/orc/bens?proposta=${encodeURIComponent(p.numero)}`}>{`Bens da proposta ${p.numero}`}</a>}
                      {podeVersionar(p) && (
                        <AcaoConfirmada
                          rotulo={`Nova versão da proposta ${p.numero}`}
                          pergunta={MENSAGENS_ORC.CONFIRMA_NOVA_VERSAO(p.numero)}
                          acao={acoes.novaVersao}
                          campos={{ id: p.id, versao: String(p.versao) }}
                        />
                      )}
                      {permissoes.podeIncluir && <a href={`/orc/propostas?duplicar=${p.id}`}>{`Duplicar a proposta ${p.numero}`}</a>}
                      {podeExcluir(p) && (
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
      {duplicacao && !origem && <p role="status">{MENSAGENS_ORC.PROPOSTA_INEXISTENTE}</p>}
      {permissoes.podeIncluir &&
        ccsLivres !== null &&
        (ccsLivres.length === 0 ? (
          <p role="note">{MENSAGENS_ORC.SEM_CC_LIVRE_TP}</p>
        ) : origem ? (
          <FormDuplicarProposta origem={origem} ccs={ccsLivres} duplicar={acoes.duplicar} />
        ) : (
          <FormProposta ccs={ccsLivres} salvar={acoes.criar} />
        ))}
    </>
  );
}
