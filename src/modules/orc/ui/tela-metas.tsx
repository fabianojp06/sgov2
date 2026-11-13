import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { BlocoMetas, FiltrosMetas } from '../application/metas';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { LIMITE_NUMERO_META, ROTULO_STATUS_META } from '../domain/meta';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA, TIPOS_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';
import { FormMeta } from './form-meta';

// Tela das metas da proposta (US-067, UC03.14 a UC03.17; plano do P19, Task 2). Server Component: os filtros
// (Tipo, Proposta e Meta, REQ0024 e REQ0030) num formulário GET; um bloco por proposta (RN0137), com a última
// versão, a grade (Número, Nome, Valor global e Status, RN0135), o total das metas ativas (RN0149) e o saldo a
// distribuir (RN0142, D-P19-4). "Nova meta", "Editar" e "Excluir" só com a permissão e a versão editável
// (RN0183); a proposta Consolidada mostra a nota no lugar da grade (D-P19-2). O formulário abre pela URL
// (?nova=<proposta> ou ?editar=<meta>), acima da lista.

/** Aviso depois de incluir, alterar ou excluir, com o número da meta vindo da ação (?m=). */
export function textoAvisoMeta(aviso: string | undefined, numero: string | undefined): string | undefined {
  if (!numero || [...numero].length > LIMITE_NUMERO_META) return undefined;
  if (aviso === 'incluida') return MENSAGENS_ORC.META_INCLUIDA(numero);
  if (aviso === 'alterada') return MENSAGENS_ORC.META_ALTERADA(numero);
  if (aviso === 'excluida') return MENSAGENS_ORC.META_EXCLUIDA(numero);
  return undefined;
}

export type PermissoesMeta = { podeIncluir: boolean; podeAlterar: boolean; podeExcluir: boolean };

/** O formulário aberto pela URL: incluir numa proposta ou alterar uma meta. */
export type FormularioMetaAberto = { modo: 'incluir'; propostaId: string } | { modo: 'alterar'; metaId: string };

function Filtros({ filtros }: { filtros: FiltrosMetas }) {
  return (
    <form method="get" action="/orc/metas" role="search" aria-label="Pesquisar metas">
      <label htmlFor="filtro-tipo">Tipo</label>
      <select id="filtro-tipo" name="tipo" defaultValue={filtros.tipo ?? ''}>
        <option value="">Todos</option>
        {TIPOS_PROPOSTA.map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_PROPOSTA[t]}
          </option>
        ))}
      </select>{' '}
      <label htmlFor="filtro-proposta">Proposta</label>
      <input id="filtro-proposta" name="proposta" defaultValue={filtros.proposta ?? ''} />{' '}
      <label htmlFor="filtro-meta">Meta</label>
      <input id="filtro-meta" name="meta" defaultValue={filtros.meta ?? ''} /> <button type="submit">Pesquisar</button>
    </form>
  );
}

function Bloco({ bloco, permissoes, excluir }: { bloco: BlocoMetas; permissoes: PermissoesMeta; excluir: AcaoFormulario }) {
  const titulo = `metas-${bloco.propostaId}`;
  const podeAlterar = permissoes.podeAlterar && bloco.editavel;
  const podeExcluir = permissoes.podeExcluir && bloco.editavel;
  const comAcoes = podeAlterar || podeExcluir;
  return (
    <section aria-labelledby={titulo}>
      <h2 id={titulo}>{`${bloco.numero} – ${bloco.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[bloco.situacao]}</span>
      </p>
      {bloco.categoria !== 'META' ? (
        <p role="note">{MENSAGENS_ORC.META_SEM_CATEGORIA}</p>
      ) : (
        <>
          {bloco.metas.length === 0 ? (
            <p>Nenhuma meta encontrada nesta versão.</p>
          ) : (
            <div role="region" aria-labelledby={`${titulo}-caption`} tabIndex={0} style={{ overflowX: 'auto' }}>
              <table>
                <caption id={`${titulo}-caption`}>{`Metas da proposta ${bloco.numero}, valores em R$`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Número</th>
                    <th scope="col">Nome</th>
                    <th scope="col">Valor global</th>
                    <th scope="col">Status</th>
                    {comAcoes && <th scope="col">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {bloco.metas.map((m) => (
                    <tr key={m.id}>
                      <th scope="row">{m.numero}</th>
                      <td>{m.nome}</td>
                      <td>{valorParaTela(m.valor)}</td>
                      <td>{ROTULO_STATUS_META[m.status]}</td>
                      {comAcoes && (
                        <td>
                          {podeAlterar && <a href={`/orc/metas?editar=${m.id}`}>{`Editar a meta ${m.numero}`}</a>}
                          {podeExcluir && (
                            <AcaoConfirmada
                              rotulo={`Excluir a meta ${m.numero}`}
                              pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_META}
                              acao={excluir}
                              campos={{ id: m.id, versao: String(m.versao), versaoCapa: String(bloco.versaoCapa) }}
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
          <dl>
            <dt>Total das metas ativas (R$)</dt>
            <dd>{valorParaTela(bloco.totalMetas)}</dd>
            <dt>Saldo a distribuir (R$)</dt>
            <dd>
              {valorParaTela(bloco.saldo)}
              <span> Valor global calculado da proposta menos o total das metas. A soma das metas é conferida no envio para aprovação.</span>
            </dd>
          </dl>
          {permissoes.podeIncluir && bloco.editavel && <a href={`/orc/metas?nova=${bloco.propostaId}`}>{`Nova meta na proposta ${bloco.numero}`}</a>}
        </>
      )}
    </section>
  );
}

export function TelaMetas({
  blocos,
  filtros,
  permissoes,
  acoes,
  aviso,
  formulario,
}: {
  blocos: readonly BlocoMetas[];
  filtros: FiltrosMetas;
  permissoes: PermissoesMeta;
  acoes: { incluir: AcaoFormulario; alterar: AcaoFormulario; excluir: AcaoFormulario };
  aviso?: string | undefined;
  formulario?: FormularioMetaAberto | null | undefined;
}) {
  // O formulário só abre sobre um bloco editável que está na lista (a RLS já filtrou) e com a permissão.
  const editaveis = blocos.filter((b) => b.editavel);
  const blocoNovo = formulario?.modo === 'incluir' && permissoes.podeIncluir ? editaveis.find((b) => b.propostaId === formulario.propostaId) : undefined;
  const alvo =
    formulario?.modo === 'alterar' && permissoes.podeAlterar
      ? editaveis.flatMap((b) => b.metas.map((m) => ({ bloco: b, meta: m }))).find((x) => x.meta.id === formulario.metaId)
      : undefined;
  const naoAbriu = formulario && !blocoNovo && !alvo;
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {naoAbriu && <p role="status">{formulario.modo === 'incluir' ? MENSAGENS_ORC.PROPOSTA_INEXISTENTE : MENSAGENS_ORC.META_INEXISTENTE}</p>}
      {blocoNovo && <FormMeta bloco={blocoNovo} salvar={acoes.incluir} />}
      {alvo && <FormMeta bloco={alvo.bloco} meta={alvo.meta} salvar={acoes.alterar} />}
      <Filtros filtros={filtros} />
      {blocos.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        blocos.map((b) => <Bloco key={b.propostaId} bloco={b} permissoes={permissoes} excluir={acoes.excluir} />)
      )}
    </>
  );
}
