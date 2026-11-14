import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import type { BlocoEmpregados, GrupoEmpregados, OpcaoCargoEmpregado, TotaisCategoria } from '../application/empregados';
import type { FiltrosPessoal } from '../application/pessoal-comum';
import { A_CONTRATAR, LIMITE_NOME_EMPREGADO, ROTULO_CATEGORIA_EMPREGADO } from '../domain/empregado';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { valorParaTela } from '../domain/valor-tela';
import { FiltrosPessoalProposta, mesAno } from './filtros-pessoal';
import { FormEmpregado } from './form-empregado';

// Tela dos empregados da proposta (US-070, UC03.24 a UC03.27; plano do P20, Task 2). Server Component: os
// filtros num formulário GET; um bloco por proposta com a última versão, os grupos por meta só na categoria
// Meta (RN0148) e os totais por categoria (RN0147, RN0194). A grade mostra Ordem, Empregado ("A CONTRATAR"
// sem nome, REQ_EMP_003), Categoria, Cargo, Vínculo Funcional (herdado do cargo, RN_EMP_008) e Competência; o Custo total mensal só para quem lança (D-P20-5).
// "Novo empregado", "Editar" e "Excluir" só com a permissão e a versão editável (RN0183). O formulário abre
// pela URL (?nova=<proposta> ou ?editar=<empregado>), acima da lista.

/** Aviso depois de incluir, alterar ou excluir, com a ordem e o nome vindos da ação (?o= e ?n=). */
export function textoAvisoEmpregado(aviso: string | undefined, ordem: string | undefined, nome: string | undefined): string | undefined {
  if (!ordem || !/^\d{1,6}$/.test(ordem) || !nome || [...nome].length > LIMITE_NOME_EMPREGADO) return undefined;
  const o = Number(ordem);
  if (aviso === 'incluido') return MENSAGENS_ORC.EMPREGADO_INCLUIDO(o, nome);
  if (aviso === 'alterado') return MENSAGENS_ORC.EMPREGADO_ALTERADO(o, nome);
  if (aviso === 'excluido') return MENSAGENS_ORC.EMPREGADO_EXCLUIDO(o, nome);
  return undefined;
}

export type PermissoesPessoal = { podeIncluir: boolean; podeAlterar: boolean; podeExcluir: boolean };

/** O formulário aberto pela URL: incluir numa proposta ou alterar um registro. */
export type FormularioPessoalAberto = { modo: 'incluir'; propostaId: string } | { modo: 'alterar'; id: string };

/** Os totais por categoria (RN0147, RN0194), numa linha. */
export function TotaisPorCategoria({ rotulo, totais }: { rotulo: string; totais: TotaisCategoria }) {
  return (
    <p>
      <strong>{rotulo}:</strong>{' '}
      {`Empregados ${totais.EMPREGADO} · Estagiários ${totais.ESTAGIARIO} · Jovens Aprendizes ${totais.JOVEM_APRENDIZ}`}
    </p>
  );
}

function Grupo({ bloco, grupo, permissoes, excluir }: { bloco: BlocoEmpregados; grupo: GrupoEmpregados; permissoes: PermissoesPessoal; excluir: AcaoFormulario }) {
  const titulo = `empregados-${bloco.propostaId}-${grupo.metaId ?? 'sem-meta'}`;
  const podeAlterar = permissoes.podeAlterar && bloco.editavel;
  const podeExcluir = permissoes.podeExcluir && bloco.editavel;
  const comAcoes = podeAlterar || podeExcluir;
  const legenda = grupo.metaNumero ? `Meta ${grupo.metaNumero} – ${grupo.metaNome}` : `Empregados da proposta ${bloco.numero}`;
  return (
    <div role="region" aria-labelledby={`${titulo}-caption`} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption id={`${titulo}-caption`}>{bloco.veCusto ? `${legenda}, custos em R$` : legenda}</caption>
        <thead>
          <tr>
            <th scope="col">Ordem</th>
            <th scope="col">Empregado</th>
            <th scope="col">Categoria</th>
            <th scope="col">Cargo</th>
            <th scope="col">Vínculo Funcional</th>
            <th scope="col">Competência</th>
            {bloco.veCusto && <th scope="col">Custo total mensal</th>}
            {comAcoes && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {grupo.empregados.map((e) => {
            const nome = e.nome ?? A_CONTRATAR;
            return (
              <tr key={e.id}>
                <th scope="row">{e.ordem}</th>
                <td>{nome}</td>
                <td>{ROTULO_CATEGORIA_EMPREGADO[e.categoria]}</td>
                <td>{e.cargo}</td>
                <td>{e.vinculoFuncional ?? '—'}</td>
                <td>{`${mesAno(e.inicio)} a ${mesAno(e.fim)}`}</td>
                {bloco.veCusto && (
                  <td>
                    {e.custoMensal ? valorParaTela(e.custoMensal) : '—'}
                    {e.avisos.map((a) => (
                      <small key={a} role="note">
                        {' '}
                        {a}
                      </small>
                    ))}
                  </td>
                )}
                {comAcoes && (
                  <td>
                    {podeAlterar && <a href={`/orc/empregados?editar=${e.id}`}>{`Editar o empregado ${e.ordem}`}</a>}
                    {podeExcluir && (
                      <AcaoConfirmada
                        rotulo={`Excluir o empregado ${e.ordem} (${nome})`}
                        pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_EMPREGADO}
                        acao={excluir}
                        campos={{ id: e.id, versao: String(e.versao), versaoCapa: String(bloco.versaoCapa) }}
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <TotaisPorCategoria rotulo={grupo.metaNumero ? `Total da meta ${grupo.metaNumero}` : 'Total'} totais={grupo.totais} />
    </div>
  );
}

function Bloco({ bloco, permissoes, excluir }: { bloco: BlocoEmpregados; permissoes: PermissoesPessoal; excluir: AcaoFormulario }) {
  const titulo = `empregados-${bloco.propostaId}`;
  const semMetaAtiva = bloco.categoria === 'META' && bloco.metas.length === 0;
  return (
    <section aria-labelledby={titulo}>
      <h2 id={titulo}>{`${bloco.numero} – ${bloco.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[bloco.situacao]}</span>
      </p>
      {bloco.grupos.length === 0 ? (
        <p>Nenhum empregado nesta versão.</p>
      ) : (
        bloco.grupos.map((g) => <Grupo key={g.metaId ?? 'sem-meta'} bloco={bloco} grupo={g} permissoes={permissoes} excluir={excluir} />)
      )}
      {bloco.categoria === 'META' && bloco.grupos.length > 1 && <TotaisPorCategoria rotulo="Total geral da proposta" totais={bloco.totais} />}
      {permissoes.podeIncluir &&
        bloco.editavel &&
        (semMetaAtiva ? (
          <p role="note">
            Cadastre uma meta ativa na proposta antes de lançar empregados. <a href="/orc/metas">Ir para as metas</a>
          </p>
        ) : (
          <a href={`/orc/empregados?nova=${bloco.propostaId}`}>{`Novo empregado na proposta ${bloco.numero}`}</a>
        ))}
    </section>
  );
}

export function TelaEmpregados({
  blocos,
  filtros,
  permissoes,
  acoes,
  cargos,
  aviso,
  formulario,
}: {
  blocos: readonly BlocoEmpregados[];
  filtros: FiltrosPessoal;
  permissoes: PermissoesPessoal;
  acoes: { incluir: AcaoFormulario; alterar: AcaoFormulario; excluir: AcaoFormulario };
  /** Só com o formulário aberto. */
  cargos: readonly OpcaoCargoEmpregado[];
  aviso?: string | undefined;
  formulario?: FormularioPessoalAberto | null | undefined;
}) {
  // O formulário só abre sobre um bloco editável que está na lista (a RLS já filtrou) e com a permissão.
  const editaveis = blocos.filter((b) => b.editavel);
  const blocoNovo =
    formulario?.modo === 'incluir' && permissoes.podeIncluir
      ? editaveis.find((b) => b.propostaId === formulario.propostaId && !(b.categoria === 'META' && b.metas.length === 0))
      : undefined;
  const alvo =
    formulario?.modo === 'alterar' && permissoes.podeAlterar
      ? editaveis.flatMap((b) => b.grupos.flatMap((g) => g.empregados.map((e) => ({ bloco: b, empregado: e })))).find((x) => x.empregado.id === formulario.id)
      : undefined;
  const naoAbriu = formulario && !blocoNovo && !alvo;
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {naoAbriu && <p role="status">{formulario.modo === 'incluir' ? MENSAGENS_ORC.PROPOSTA_INEXISTENTE : MENSAGENS_ORC.EMPREGADO_INEXISTENTE}</p>}
      {blocoNovo && <FormEmpregado bloco={blocoNovo} cargos={cargos} salvar={acoes.incluir} />}
      {alvo && <FormEmpregado bloco={alvo.bloco} empregado={alvo.empregado} cargos={cargos} salvar={acoes.alterar} />}
      <FiltrosPessoalProposta rota="/orc/empregados" rotulo="Pesquisar empregados" prefixo="empregados" filtros={filtros} />
      {blocos.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        blocos.map((b) => <Bloco key={b.propostaId} bloco={b} permissoes={permissoes} excluir={acoes.excluir} />)
      )}
    </>
  );
}
