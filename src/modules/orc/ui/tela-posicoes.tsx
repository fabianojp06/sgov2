import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import { Dinheiro } from '@/shared/kernel';
import type { CargosPosicao, ListaPosicoes, OpcoesPosicao, PosicaoTela } from '../application/posicoes';
import { VALOR_MASCARADO } from '../domain/mascara-historico';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';
import { FormPosicao, type AcaoPrevia } from './form-posicao';

// Tela das posições de pessoal (US-056; plano do P12, Task 2). Server Component: escolha do CC (só os
// do escopo), lista das posições do CC com Alterar e Excluir na linha e o formulário de inclusão ou
// de alteração (linha em edição destacada). Só leitura com o exercício fechado ou sem permissão.
// Quem só consulta vê o salário e o anual como VALOR_MASCARADO: o servidor nem os envia (D-P12-3).
const ORIGEM: Readonly<Record<string, string>> = { TELA: 'Tela', IMPORTACAO: 'Planilha', COPIA: 'Cópia do exercício anterior' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const periodo = (p: PosicaoTela) => (p.mesInicio === p.mesSaida ? MESES[p.mesInicio - 1] : `${MESES[p.mesInicio - 1]} a ${MESES[p.mesSaida - 1]}`);
const valor = (v: Dinheiro | null) => (v === null ? VALOR_MASCARADO : valorParaTela(v));

// [PROVISÓRIOS] (GAP-ORC-004)
const AVISOS: Readonly<Record<string, string>> = {
  incluido: `Posição incluída. ${MENSAGENS_ORC.RECALCULADO}`,
  alterado: `Posição alterada. ${MENSAGENS_ORC.RECALCULADO}`,
  excluido: `Posição excluída. ${MENSAGENS_ORC.RECALCULADO}`,
};
export const textoAvisoPosicao = (aviso: string | undefined) => (aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined);

// Posição que não é da tela: uma nova importação do CC a substitui (D-P12-7) [PROVISÓRIO].
const avisoOrigem = (p: PosicaoTela) => (p.origem === 'TELA' ? undefined : MENSAGENS_ORC.POSICAO_DA_IMPORTACAO);
// Nome acessível único por linha (ordinal e o início do cargo).
const TRECHO = 40;
const SEM_CARGOS: CargosPosicao = { cargos: [], comSalario: false, aviso: null };
const nomeCargo = (p: PosicaoTela) => (p.cargoInativo ? `${p.cargo} ${MENSAGENS_ORC.CARGO_INATIVO_ROTULO}` : p.cargo);
const descreverPosicao = (i: number, p: PosicaoTela) => `posição ${i + 1}: ${p.cargo.length > TRECHO ? `${p.cargo.slice(0, TRECHO).trimEnd()}…` : p.cargo}`;

export type PermissoesPosicao = { podeIncluir: boolean; podeAlterar: boolean; podeExcluir: boolean };

export function TelaPosicoes({
  ano,
  exercicioId,
  opcoes,
  lista,
  ccAtual,
  emEdicao,
  permissoes,
  cargos,
  acoes,
  aviso,
}: {
  ano: number;
  exercicioId: string;
  opcoes: OpcoesPosicao;
  lista: ListaPosicoes;
  ccAtual: string | null;
  emEdicao: string | null;
  permissoes: PermissoesPosicao;
  /** Cargos da escolha (P15); nulo quando o formulário não aparece. */
  cargos?: CargosPosicao | null;
  acoes: { incluir: AcaoFormulario; alterar: AcaoFormulario; excluir: AcaoFormulario; previa: AcaoPrevia };
  aviso?: string | undefined;
}) {
  // CCs da escolha: os do escopo e, para quem vê tudo, os das posições de CC fora da estrutura ativa.
  const ccsComPosicao = [...new Set(lista.posicoes.map((p) => p.cc))].filter((cc) => !opcoes.ccs.some((c) => c.classificacao === cc));
  const ccs = [...opcoes.ccs, ...ccsComPosicao.map((cc) => ({ classificacao: cc, descricao: MENSAGENS_ORC.CC_DESCONHECIDO }))];
  const posicoes = lista.posicoes.filter((p) => p.cc === ccAtual);
  const rota = (extra: string) => `/orc/posicoes?ano=${ano}&cc=${encodeURIComponent(ccAtual ?? '')}${extra}`;
  const editavel = lista.editavel;
  const acoesNaLinha = editavel && (permissoes.podeAlterar || permissoes.podeExcluir);
  const editando = editavel && permissoes.podeAlterar ? (posicoes.find((p) => p.id === emEdicao) ?? null) : null;
  const anuais = posicoes.map((p) => p.valorAnual);
  const totalCc = lista.veSalario && anuais.length > 0 && anuais.every((v) => v !== null) ? Dinheiro.somarTodos(anuais as Dinheiro[]) : null;
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {!editavel && <p>{MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(opcoes.rotuloSituacao)}</p>}
      {/* Correspondência do cargo em texto (P16, D-P16-1): quem altera com escopo TOTAL, havendo posição sem cargo. */}
      {editavel && permissoes.podeAlterar && opcoes.escopoTotal && lista.posicoes.some((p) => p.cargoId === null) && (
        <p>
          <a href={`/orc/posicoes/correspondencia?ano=${ano}`}>{MENSAGENS_ORC.CORRESPONDENCIA_LINK}</a>
        </p>
      )}
      {ccs.length === 0 ? (
        <p>Nenhum centro de custo disponível no seu escopo.</p>
      ) : (
        <form method="get" action="/orc/posicoes">
          <input type="hidden" name="ano" value={ano} />
          <label htmlFor="posicoes-cc">Centro de custo</label>
          <select id="posicoes-cc" name="cc" defaultValue={ccAtual ?? undefined}>
            {ccs.map((c) => (
              <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
            ))}
          </select>
          <button type="submit">Ver posições</button>
        </form>
      )}
      {ccAtual && (
        <section aria-labelledby="posicoes-lista">
          <h2 id="posicoes-lista">{`Posições do CC ${ccAtual}`}</h2>
          {posicoes.length === 0 ? (
            <p>Nenhuma posição neste centro de custo.</p>
          ) : (
            <div role="region" aria-labelledby="posicoes-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
              <table>
                <caption id="posicoes-caption">{`Posições de pessoal do CC ${ccAtual} em ${ano}, valores em R$`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Cargo</th>
                    <th scope="col">Quantidade</th>
                    <th scope="col">Salário mensal</th>
                    <th scope="col">Meses</th>
                    <th scope="col">Custo anual</th>
                    <th scope="col">Origem</th>
                    {acoesNaLinha && <th scope="col">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {posicoes.map((p, i) => {
                    const destacada = editando?.id === p.id;
                    return (
                      <tr key={p.id} aria-current={destacada ? 'true' : undefined} className={destacada ? 'em-edicao' : undefined} style={destacada ? { outline: '2px solid currentColor' } : undefined}>
                        <th scope="row">{nomeCargo(p)}</th>
                        <td>{p.quantidade}</td>
                        <td>{valor(p.salarioMensal)}</td>
                        <td>{periodo(p)}</td>
                        <td>{valor(p.valorAnual)}</td>
                        <td>{ORIGEM[p.origem] ?? p.origem}</td>
                        {acoesNaLinha && (
                          <td>
                            {permissoes.podeAlterar && <a href={rota(`&editar=${p.id}#form-posicao`)}>{`Alterar ${descreverPosicao(i, p)}`}</a>}
                            {permissoes.podeExcluir && (
                              <AcaoConfirmada
                                rotulo={`Excluir ${descreverPosicao(i, p)}`}
                                pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_POSICAO(p.cargo, p.cc)}
                                acao={acoes.excluir}
                                campos={{ id: p.id, versao: String(p.versao) }}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {totalCc && (
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={4}>
                        Total do CC
                      </th>
                      <td>{valorParaTela(totalCc)}</td>
                      <td colSpan={acoesNaLinha ? 2 : 1} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>
      )}
      {editavel && ccAtual && (
        <div id="form-posicao">
          {editando ? (
            <FormPosicao
              key={editando.id}
              ano={ano}
              exercicioId={exercicioId}
              ccAtual={ccAtual}
              ccs={opcoes.ccs}
              quantidadeMaxima={opcoes.quantidadeMaxima}
              cargos={cargos ?? SEM_CARGOS}
              posicao={{
                id: editando.id,
                cc: editando.cc,
                cargo: editando.cargo,
                cargoId: editando.cargoId,
                cargoInativo: editando.cargoInativo,
                quantidade: String(editando.quantidade),
                // Quem altera vê o salário (D-P12-3): nunca nulo aqui.
                salarioMensal: editando.salarioMensal ? valorParaTela(editando.salarioMensal) : '',
                mesInicio: String(editando.mesInicio),
                mesSaida: String(editando.mesSaida),
                observacao: editando.observacao ?? '',
                versao: editando.versao,
              }}
              avisoOrigem={avisoOrigem(editando)}
              salvar={acoes.alterar}
              previa={acoes.previa}
              cancelarPara={rota('')}
            />
          ) : (
            permissoes.podeIncluir &&
            opcoes.ccs.some((c) => c.classificacao === ccAtual) && (
              <FormPosicao
                key={`nova-${ccAtual}`}
                ano={ano}
                exercicioId={exercicioId}
                ccAtual={ccAtual}
                ccs={opcoes.ccs}
                quantidadeMaxima={opcoes.quantidadeMaxima}
                cargos={cargos ?? SEM_CARGOS}
                salvar={acoes.incluir}
                previa={acoes.previa}
                cancelarPara={rota('')}
              />
            )
          )}
        </div>
      )}
    </>
  );
}
