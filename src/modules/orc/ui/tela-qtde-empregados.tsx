import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { FiltrosPessoal } from '../application/pessoal-comum';
import type { BlocoQtdes, GrupoQtdes } from '../application/qtde-empregados';
import { LIMITE_DOCUMENTO_QTDE } from '../domain/empregado';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { FiltrosPessoalProposta, mesAno } from './filtros-pessoal';
import { FormQtdeEmpregado } from './form-qtde-empregado';
import { TotaisPorCategoria, type FormularioPessoalAberto, type PermissoesPessoal } from './tela-empregados';

// Tela dos quantitativos de pessoal por período (US-070, UC03.20 a UC03.23; plano do P20, Task 2). Um bloco por
// proposta, com os grupos por meta só na categoria Meta (RN0146, RN0148). Cada linha mostra o documento, o
// período e as quantidades contadas dos empregados (RN0457), só leitura; o total da meta (RN0194) e o geral da
// proposta (RN0147). O formulário abre pela URL (?nova=<proposta> ou ?editar=<quantitativo>).

/** Aviso depois de incluir, alterar ou excluir, com o documento vindo da ação (?d=). */
export function textoAvisoQtde(aviso: string | undefined, documento: string | undefined): string | undefined {
  if (!documento || [...documento].length > LIMITE_DOCUMENTO_QTDE) return undefined;
  if (aviso === 'incluida') return MENSAGENS_ORC.QTDE_INCLUIDA(documento);
  if (aviso === 'alterada') return MENSAGENS_ORC.QTDE_ALTERADA(documento);
  if (aviso === 'excluida') return MENSAGENS_ORC.QTDE_EXCLUIDA(documento);
  return undefined;
}

function Grupo({ bloco, grupo, permissoes, excluir }: { bloco: BlocoQtdes; grupo: GrupoQtdes; permissoes: PermissoesPessoal; excluir: AcaoFormulario }) {
  const titulo = `qtdes-${bloco.propostaId}-${grupo.metaId ?? 'sem-meta'}`;
  const podeAlterar = permissoes.podeAlterar && bloco.editavel;
  const podeExcluir = permissoes.podeExcluir && bloco.editavel;
  const comAcoes = podeAlterar || podeExcluir;
  return (
    <div role="region" aria-labelledby={`${titulo}-caption`} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption id={`${titulo}-caption`}>{grupo.metaNumero ? `Meta ${grupo.metaNumero} – ${grupo.metaNome}` : `Quantitativos da proposta ${bloco.numero}`}</caption>
        <thead>
          <tr>
            <th scope="col">Número do documento</th>
            <th scope="col">Período inicial</th>
            <th scope="col">Período final</th>
            <th scope="col">Qtde. Empregados</th>
            <th scope="col">Qtde. Estagiários</th>
            <th scope="col">Qtde. Jovens Aprendizes</th>
            {comAcoes && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {grupo.qtdes.map((q) => (
            <tr key={q.id}>
              <th scope="row">{q.documento}</th>
              <td>{mesAno(q.inicio)}</td>
              <td>{mesAno(q.fim)}</td>
              <td>{q.quantidades.EMPREGADO}</td>
              <td>{q.quantidades.ESTAGIARIO}</td>
              <td>{q.quantidades.JOVEM_APRENDIZ}</td>
              {comAcoes && (
                <td>
                  {podeAlterar && <a href={`/orc/qtde-empregados?editar=${q.id}`}>{`Editar o quantitativo ${q.documento}`}</a>}
                  {podeExcluir && (
                    <AcaoConfirmada
                      rotulo={`Excluir o quantitativo ${q.documento}`}
                      pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_QTDE}
                      acao={excluir}
                      campos={{ id: q.id, versao: String(q.versao), versaoCapa: String(bloco.versaoCapa) }}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <TotaisPorCategoria rotulo={grupo.metaNumero ? `Total da meta ${grupo.metaNumero}` : 'Total'} totais={grupo.totais} />
    </div>
  );
}

function Bloco({ bloco, permissoes, excluir }: { bloco: BlocoQtdes; permissoes: PermissoesPessoal; excluir: AcaoFormulario }) {
  const titulo = `qtdes-${bloco.propostaId}`;
  const semMetaAtiva = bloco.categoria === 'META' && bloco.metas.length === 0;
  return (
    <section aria-labelledby={titulo}>
      <h2 id={titulo}>{`${bloco.numero} – ${bloco.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[bloco.situacao]}</span>
      </p>
      {bloco.grupos.length === 0 ? (
        <p>Nenhum quantitativo nesta versão.</p>
      ) : (
        bloco.grupos.map((g) => <Grupo key={g.metaId ?? 'sem-meta'} bloco={bloco} grupo={g} permissoes={permissoes} excluir={excluir} />)
      )}
      {bloco.categoria === 'META' && bloco.grupos.length > 1 && <TotaisPorCategoria rotulo="Total geral da proposta" totais={bloco.totais} />}
      {permissoes.podeIncluir &&
        bloco.editavel &&
        (semMetaAtiva ? (
          <p role="note">
            Cadastre uma meta ativa na proposta antes de lançar quantitativos. <a href="/orc/metas">Ir para as metas</a>
          </p>
        ) : (
          <a href={`/orc/qtde-empregados?nova=${bloco.propostaId}`}>{`Novo quantitativo na proposta ${bloco.numero}`}</a>
        ))}
    </section>
  );
}

export function TelaQtdeEmpregados({
  blocos,
  filtros,
  permissoes,
  acoes,
  aviso,
  formulario,
}: {
  blocos: readonly BlocoQtdes[];
  filtros: FiltrosPessoal;
  permissoes: PermissoesPessoal;
  acoes: { incluir: AcaoFormulario; alterar: AcaoFormulario; excluir: AcaoFormulario };
  aviso?: string | undefined;
  formulario?: FormularioPessoalAberto | null | undefined;
}) {
  const editaveis = blocos.filter((b) => b.editavel);
  const blocoNovo =
    formulario?.modo === 'incluir' && permissoes.podeIncluir
      ? editaveis.find((b) => b.propostaId === formulario.propostaId && !(b.categoria === 'META' && b.metas.length === 0))
      : undefined;
  const alvo =
    formulario?.modo === 'alterar' && permissoes.podeAlterar
      ? editaveis.flatMap((b) => b.grupos.flatMap((g) => g.qtdes.map((q) => ({ bloco: b, qtde: q })))).find((x) => x.qtde.id === formulario.id)
      : undefined;
  const naoAbriu = formulario && !blocoNovo && !alvo;
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {naoAbriu && <p role="status">{formulario.modo === 'incluir' ? MENSAGENS_ORC.PROPOSTA_INEXISTENTE : MENSAGENS_ORC.QTDE_INEXISTENTE}</p>}
      {blocoNovo && <FormQtdeEmpregado bloco={blocoNovo} salvar={acoes.incluir} />}
      {alvo && <FormQtdeEmpregado bloco={alvo.bloco} qtde={alvo.qtde} salvar={acoes.alterar} />}
      <FiltrosPessoalProposta rota="/orc/qtde-empregados" rotulo="Pesquisar quantitativos" prefixo="qtdes" filtros={filtros} />
      {blocos.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        blocos.map((b) => <Bloco key={b.propostaId} bloco={b} permissoes={permissoes} excluir={acoes.excluir} />)
      )}
    </>
  );
}
