import type { ReactNode } from 'react';
import { AcaoConfirmada, ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import { ROTULO_FLUXO } from '@/modules/adm';
import type { FiltrosTarefas, ItemResumo, TarefaTela } from '../application/solicitacoes';
import { JUSTIFICATIVA_MINIMA, LIMITE_JUSTIFICATIVA, MENSAGENS_APR, ROTULO_SITUACAO_SOLICITACAO, type SituacaoSolicitacao } from '../domain/solicitacao';

// Central de Tarefas do aprovador (US-078; RF_APR_REQ_002, 003 e 005; plano do P26, D-P26-8). Server Component: a
// lista das solicitações roteadas para o usuário, com os filtros num formulário GET; a tarefa aberta (?abrir=)
// mostra o resumo do alvo (só leitura) e as ações Aprovar e Rejeitar, esta com a justificativa obrigatória.

const COR: Readonly<Record<SituacaoSolicitacao, string>> = { EM_APROVACAO: '#9a6700', APROVADO: '#1a7f37', REJEITADO: '#cf222e' };

/** RF_APR_REQ_005: o badge da situação, em texto e cor. */
export function SeloSituacao({ situacao }: { situacao: SituacaoSolicitacao }) {
  return (
    <span className="selo" style={{ borderColor: COR[situacao], color: COR[situacao] }}>
      {ROTULO_SITUACAO_SOLICITACAO[situacao]}
    </span>
  );
}

const dataHora = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function textoAvisoTarefa(aviso: string | undefined, descricao: string | undefined): string | undefined {
  if (!descricao || [...descricao].length > 300) return undefined;
  if (aviso === 'aprovada') return MENSAGENS_APR.APROVADA(descricao);
  if (aviso === 'rejeitada') return MENSAGENS_APR.REJEITADA(descricao);
  return undefined;
}

function Filtros({ filtros }: { filtros: FiltrosTarefas }) {
  return (
    <form method="get" action="/apr/tarefas" role="search" aria-label="Pesquisar tarefas">
      <label htmlFor="tarefas-situacao">Situação</label>
      <select id="tarefas-situacao" name="situacao" defaultValue={filtros.situacao ?? ''}>
        <option value="">Todas</option>
        {(['EM_APROVACAO', 'APROVADO', 'REJEITADO'] as const).map((s) => (
          <option key={s} value={s}>
            {ROTULO_SITUACAO_SOLICITACAO[s]}
          </option>
        ))}
      </select>{' '}
      <label htmlFor="tarefas-de">Enviada de</label>
      <input id="tarefas-de" name="de" type="date" defaultValue={filtros.de ?? ''} /> <label htmlFor="tarefas-ate">até</label>
      <input id="tarefas-ate" name="ate" type="date" defaultValue={filtros.ate ?? ''} /> <label htmlFor="tarefas-tp">TP</label>
      <input id="tarefas-tp" name="tp" defaultValue={filtros.tp ?? ''} /> <button type="submit">Pesquisar</button>
    </form>
  );
}

function Aberta({
  tarefa,
  resumo,
  podeDecidir,
  decidir,
  ajudaRecusa,
}: {
  tarefa: TarefaTela;
  resumo: readonly ItemResumo[];
  podeDecidir: boolean;
  decidir: AcaoFormulario;
  ajudaRecusa?: ReactNode;
}) {
  const pendente = tarefa.situacao === 'EM_APROVACAO';
  return (
    <section aria-labelledby="tarefa-aberta">
      <h2 id="tarefa-aberta">{`${ROTULO_FLUXO[tarefa.fluxo]}: ${tarefa.descricao}`}</h2>
      <p>
        {`Enviada por ${tarefa.solicitante} em ${dataHora(tarefa.enviadaEm)} · você é o ${tarefa.papelAprovador === 'TITULAR' ? 'titular' : 'substituto'} da alçada `}
        <SeloSituacao situacao={tarefa.situacao} />
      </p>
      {resumo.length > 0 && (
        <dl>
          {resumo.map((r) => (
            <div key={r.rotulo}>
              <dt>{r.rotulo}</dt>
              <dd>{r.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {tarefa.justificativa && <p>{`Justificativa da recusa: ${tarefa.justificativa}`}</p>}
      {pendente && podeDecidir && (
        <>
          <AcaoConfirmada
            rotulo={`Aprovar: ${tarefa.descricao}`}
            pergunta={MENSAGENS_APR.CONFIRMA_APROVAR}
            acao={decidir}
            campos={{ id: tarefa.id, versao: String(tarefa.versao), decisao: 'APROVAR' }}
          />
          <section aria-labelledby="tarefa-rejeitar">
            <h3 id="tarefa-rejeitar">Rejeitar</h3>
            <Formulario acao={decidir} textoEnviar="Confirmar rejeição">
              <input type="hidden" name="id" value={tarefa.id} />
              <input type="hidden" name="versao" value={String(tarefa.versao)} />
              <input type="hidden" name="decisao" value="REJEITAR" />
              <p>
                <label htmlFor="tarefa-justificativa">{`Justificativa da recusa (mínimo de ${JUSTIFICATIVA_MINIMA} caracteres)`}</label>
                <textarea
                  id="tarefa-justificativa"
                  name="justificativa"
                  minLength={JUSTIFICATIVA_MINIMA}
                  maxLength={LIMITE_JUSTIFICATIVA}
                  rows={4}
                  aria-required="true"
                  aria-describedby="erro-justificativa"
                />
                <ErroDoCampo campo="justificativa" />
              </p>
              {ajudaRecusa}
            </Formulario>
          </section>
        </>
      )}
      <p>
        <a href="/apr/tarefas">Voltar para a Central de Tarefas</a>
      </p>
    </section>
  );
}

export function TelaTarefas({
  tarefas,
  filtros,
  aberta,
  podeDecidir,
  decidir,
  aviso,
  ajudaRecusa,
}: {
  tarefas: readonly TarefaTela[];
  filtros: FiltrosTarefas;
  aberta: { tarefa: TarefaTela; resumo: readonly ItemResumo[] } | null;
  podeDecidir: boolean;
  decidir: AcaoFormulario;
  aviso?: string | undefined;
  /** A ajuda da IA na recusa, pronta (US-084, D-P30-6): vem da página, porque o apr não importa o orc. */
  ajudaRecusa?: ReactNode;
}) {
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {aberta && <Aberta tarefa={aberta.tarefa} resumo={aberta.resumo} podeDecidir={podeDecidir} decidir={decidir} ajudaRecusa={ajudaRecusa} />}
      <Filtros filtros={filtros} />
      {tarefas.length === 0 ? (
        <p>Nenhuma solicitação roteada para você.</p>
      ) : (
        <div role="region" aria-labelledby="tarefas-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption id="tarefas-caption">Solicitações roteadas para você</caption>
            <thead>
              <tr>
                <th scope="col">Solicitação</th>
                <th scope="col">Fluxo</th>
                <th scope="col">Solicitante</th>
                <th scope="col">Enviada em</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t) => (
                <tr key={t.id}>
                  <th scope="row">
                    <a href={`/apr/tarefas?abrir=${t.id}`}>{t.descricao}</a>
                  </th>
                  <td>{ROTULO_FLUXO[t.fluxo]}</td>
                  <td>{t.solicitante}</td>
                  <td>{dataHora(t.enviadaEm)}</td>
                  <td>
                    <SeloSituacao situacao={t.situacao} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
