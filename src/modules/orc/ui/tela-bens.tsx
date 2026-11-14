import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { BemTela, BlocoBens, FiltrosBens, GrupoBens, OpcoesBem } from '../application/bens';
import { dataParaTela, LIMITE_DESCRICAO_BEM } from '../domain/bem';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA, TIPOS_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';
import { FormBem } from './form-bem';
import type { PermissoesPessoal } from './tela-empregados';

// Tela dos bens, serviços e equipamentos da proposta (US-072; UC03.34 a UC03.37; plano do P22, Task 2 e D-P22-7).
// Server Component: os filtros num formulário GET (RF_PAT_REQ_002, RN0383) e um bloco por proposta com a última
// versão. Dentro do bloco, um grupo por conta analítica em ordem crescente (RF_PAT_REQ_001, RN0417), com as
// colunas Data, Descrição, Quantidade, Valor unitário e Valor total (RF_PAT_REQ_003), o subtotal da conta
// (RN0415) e o total geral (RN0413). A grade é só leitura (RF_PAT_REQ_006). O formulário abre pela URL
// (?nova=<proposta> ou ?editar=<bem>), acima da lista.

/** Aviso depois de uma operação, com a descrição vinda da ação (?d=). */
export function textoAvisoBem(aviso: string | undefined, descricao: string | undefined): string | undefined {
  if (!descricao || [...descricao].length > LIMITE_DESCRICAO_BEM) return undefined;
  if (aviso === 'incluido') return MENSAGENS_ORC.BEM_INCLUIDO(descricao);
  if (aviso === 'alterado') return MENSAGENS_ORC.BEM_ALTERADO(descricao);
  if (aviso === 'excluido') return MENSAGENS_ORC.BEM_EXCLUIDO(descricao);
  if (aviso === 'inativado') return MENSAGENS_ORC.BEM_INATIVADO(descricao);
  return undefined;
}

export type FormularioBemAberto = { modo: 'incluir'; propostaId: string } | { modo: 'alterar'; id: string };

function Filtros({ filtros }: { filtros: FiltrosBens }) {
  const id = (campo: string) => `bens-filtro-${campo}`;
  return (
    <form method="get" action="/orc/bens" role="search" aria-label="Pesquisar bens, serviços e equipamentos">
      <label htmlFor={id('tipo')}>Tipo</label>
      <select id={id('tipo')} name="tipo" defaultValue={filtros.tipo ?? ''}>
        <option value="">Todos</option>
        {TIPOS_PROPOSTA.map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_PROPOSTA[t]}
          </option>
        ))}
      </select>{' '}
      <label htmlFor={id('proposta')}>Proposta</label>
      <input id={id('proposta')} name="proposta" defaultValue={filtros.proposta ?? ''} /> <label htmlFor={id('meta')}>Meta</label>
      <input id={id('meta')} name="meta" defaultValue={filtros.meta ?? ''} /> <label htmlFor={id('descricao')}>Descrição</label>
      <input id={id('descricao')} name="descricao" defaultValue={filtros.descricao ?? ''} /> <label htmlFor={id('conta')}>Conta (número ou nome)</label>
      <input id={id('conta')} name="conta" defaultValue={filtros.conta ?? ''} /> <label htmlFor={id('inicio')}>Data inicial</label>
      <input id={id('inicio')} name="inicio" type="date" defaultValue={filtros.inicio ?? ''} /> <label htmlFor={id('fim')}>Data final</label>
      <input id={id('fim')} name="fim" type="date" defaultValue={filtros.fim ?? ''} /> <label htmlFor={id('zerados')}>Exibir valores zerados</label>
      <select id={id('zerados')} name="zerados" defaultValue={filtros.exibirZerados === false ? 'nao' : 'sim'}>
        <option value="sim">Sim</option>
        <option value="nao">Não</option>
      </select>{' '}
      <label htmlFor={id('inativos')}>Exibir inativos</label>
      <input id={id('inativos')} name="inativos" type="checkbox" value="sim" defaultChecked={filtros.exibirInativos === true} /> <button type="submit">Pesquisar</button>
    </form>
  );
}

const cabecalhoColunas = (comMeta: boolean, comAcoes: boolean) => (
  <tr>
    <th scope="col">Data</th>
    <th scope="col">Descrição</th>
    {comMeta && <th scope="col">Meta</th>}
    <th scope="col">Quantidade</th>
    <th scope="col">Valor unitário</th>
    <th scope="col">Valor total</th>
    {comAcoes && <th scope="col">Ações</th>}
  </tr>
);

function Linha({ bloco, bem, podeAlterar, podeExcluir, excluir }: { bloco: BlocoBens; bem: BemTela; podeAlterar: boolean; podeExcluir: boolean; excluir: AcaoFormulario }) {
  const comMeta = bloco.categoria === 'META';
  return (
    <tr>
      <th scope="row">{dataParaTela(new Date(`${bem.data}T00:00:00Z`))}</th>
      <td>{bem.descricao}</td>
      {comMeta && <td>{bem.meta ?? '—'}</td>}
      <td>{bem.quantidade}</td>
      <td>{valorParaTela(bem.valorUnitario)}</td>
      <td>{valorParaTela(bem.valorTotal)}</td>
      {(podeAlterar || podeExcluir) && (
        <td>
          {podeAlterar && <a href={`/orc/bens?editar=${bem.id}`}>{`Editar o item ${bem.descricao}`}</a>}
          {podeExcluir && (
            <AcaoConfirmada
              rotulo={bem.copiado ? `Inativar o item ${bem.descricao}` : `Excluir o item ${bem.descricao}`}
              pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_BEM}
              acao={excluir}
              campos={{ id: bem.id, versao: String(bem.versao), versaoCapa: String(bloco.versaoCapa) }}
            />
          )}
        </td>
      )}
    </tr>
  );
}

function Grupo({ bloco, grupo, permissoes, excluir }: { bloco: BlocoBens; grupo: GrupoBens; permissoes: PermissoesPessoal; excluir: AcaoFormulario }) {
  const titulo = `bens-${bloco.propostaId}-${grupo.conta}`;
  const podeAlterar = permissoes.podeAlterar && bloco.editavel;
  const podeExcluir = permissoes.podeExcluir && bloco.editavel;
  const comMeta = bloco.categoria === 'META';
  return (
    <div role="region" aria-labelledby={`${titulo}-caption`} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption id={`${titulo}-caption`}>{`Conta ${grupo.conta} – ${grupo.descricaoConta}, valores em R$`}</caption>
        <thead>{cabecalhoColunas(comMeta, podeAlterar || podeExcluir)}</thead>
        <tbody>
          {grupo.itens.map((b) => (
            <Linha key={b.id} bloco={bloco} bem={b} podeAlterar={podeAlterar} podeExcluir={podeExcluir} excluir={excluir} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={comMeta ? 5 : 4}>{`Subtotal da conta ${grupo.conta}`}</th>
            <td>{valorParaTela(grupo.subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Bloco({ bloco, permissoes, excluir }: { bloco: BlocoBens; permissoes: PermissoesPessoal; excluir: AcaoFormulario }) {
  const titulo = `bens-${bloco.propostaId}`;
  const semMetaAtiva = bloco.categoria === 'META' && bloco.metas.length === 0;
  return (
    <section aria-labelledby={titulo}>
      <h2 id={titulo}>{`${bloco.numero} – ${bloco.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[bloco.situacao]}</span>
      </p>
      {bloco.grupos.length === 0 ? (
        <p>Nenhum bem, serviço ou equipamento nesta versão.</p>
      ) : (
        bloco.grupos.map((g) => <Grupo key={g.conta} bloco={bloco} grupo={g} permissoes={permissoes} excluir={excluir} />)
      )}
      <p>
        <strong>Total geral da proposta:</strong> {`R$ ${valorParaTela(bloco.total)}`}
      </p>
      {bloco.inativos > 0 && <p role="note">{`${bloco.inativos} ${bloco.inativos === 1 ? 'item inativado' : 'itens inativados'} nesta versão (vieram de versão anterior).`}</p>}
      {bloco.listaInativos.length > 0 && (
        <table>
          <caption>{`Itens inativados na proposta ${bloco.numero}, valores em R$`}</caption>
          <thead>{cabecalhoColunas(bloco.categoria === 'META', false)}</thead>
          <tbody>
            {bloco.listaInativos.map((b) => (
              <Linha key={b.id} bloco={bloco} bem={b} podeAlterar={false} podeExcluir={false} excluir={excluir} />
            ))}
          </tbody>
        </table>
      )}
      {permissoes.podeIncluir &&
        bloco.editavel &&
        (semMetaAtiva ? (
          <p role="note">
            Cadastre uma meta ativa na proposta antes de lançar bens. <a href="/orc/metas">Ir para as metas</a>
          </p>
        ) : (
          <a href={`/orc/bens?nova=${bloco.propostaId}`}>{`Novo bem, serviço ou equipamento na proposta ${bloco.numero}`}</a>
        ))}
    </section>
  );
}

export function TelaBens({
  blocos,
  filtros,
  permissoes,
  acoes,
  opcoes,
  aviso,
  formulario,
}: {
  blocos: readonly BlocoBens[];
  filtros: FiltrosBens;
  permissoes: PermissoesPessoal;
  acoes: { incluir: AcaoFormulario; alterar: AcaoFormulario; excluir: AcaoFormulario };
  opcoes: OpcoesBem | null;
  aviso?: string | undefined;
  formulario?: FormularioBemAberto | null | undefined;
}) {
  const editaveis = blocos.filter((b) => b.editavel);
  const blocoNovo =
    formulario?.modo === 'incluir' && permissoes.podeIncluir
      ? editaveis.find((b) => b.propostaId === formulario.propostaId && !(b.categoria === 'META' && b.metas.length === 0))
      : undefined;
  const alvo =
    formulario?.modo === 'alterar' && permissoes.podeAlterar
      ? editaveis.flatMap((b) => b.grupos.flatMap((g) => g.itens.map((i) => ({ bloco: b, bem: i })))).find((x) => x.bem.id === formulario.id)
      : undefined;
  const naoAbriu = formulario && (!opcoes || (!blocoNovo && !alvo));
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {naoAbriu && <p role="status">{formulario.modo === 'incluir' ? MENSAGENS_ORC.PROPOSTA_INEXISTENTE : MENSAGENS_ORC.BEM_INEXISTENTE}</p>}
      {opcoes && blocoNovo && <FormBem bloco={blocoNovo} opcoes={opcoes} salvar={acoes.incluir} />}
      {opcoes && alvo && <FormBem bloco={alvo.bloco} bem={alvo.bem} opcoes={opcoes} salvar={acoes.alterar} />}
      <Filtros filtros={filtros} />
      {blocos.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        blocos.map((b) => <Bloco key={b.propostaId} bloco={b} permissoes={permissoes} excluir={acoes.excluir} />)
      )}
    </>
  );
}
