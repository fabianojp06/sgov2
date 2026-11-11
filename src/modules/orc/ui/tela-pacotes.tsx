import { AcaoConfirmada, type AcaoFormulario } from '@/modules/ger';
import { Dinheiro } from '@/shared/kernel';
import type { ListaPacotes, OpcoesPacote, PacoteTela } from '../application/pacotes';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { valorParaTela } from '../domain/valor-tela';
import { FormPacote, type AcaoSugerirContaCc, type AcaoSugerirJustificativa } from './form-pacote';

// Tela dos pacotes base zero (US-057; plano do P11, Task 2). Server Component: escolha do CC (só os
// do escopo), lista dos pacotes do CC com Alterar e Excluir na linha e o formulário de inclusão ou
// de alteração (linha em edição destacada). Só leitura com o exercício fechado ou sem permissão.
const PRIORIDADE: Readonly<Record<string, string>> = { ESSENCIAL: 'Essencial', IMPORTANTE: 'Importante', DESEJAVEL: 'Desejável' };
const ORIGEM: Readonly<Record<string, string>> = { TELA: 'Tela', IMPORTACAO: 'Planilha', COPIA: 'Cópia do exercício anterior' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const distribuicao = (k: PacoteTela) => (k.distribuicao === 'MENSAL' ? 'Mensal' : `Pontual (${MESES[(k.mesOcorrencia ?? 1) - 1]})`);

// [PROVISÓRIOS] (GAP-ORC-004)
const AVISOS: Readonly<Record<string, string>> = {
  incluido: `Pacote incluído. ${MENSAGENS_ORC.RECALCULADO}`,
  alterado: `Pacote alterado. ${MENSAGENS_ORC.RECALCULADO}`,
  excluido: `Pacote excluído. ${MENSAGENS_ORC.RECALCULADO}`,
};
export const textoAvisoPacote = (aviso: string | undefined) => (aviso !== undefined && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined);

// Pacote que não é da tela: uma nova importação do CC o substitui (D-P11-7) [PROVISÓRIO].
const AVISO_ORIGEM: Readonly<Record<string, string | undefined>> = { IMPORTACAO: MENSAGENS_ORC.PACOTE_DA_PLANILHA, COPIA: MENSAGENS_ORC.PACOTE_DA_COPIA };
// Nome acessível único por linha (ordinal, conta e o início da justificativa).
const TRECHO = 40;
const descreverPacote = (i: number, k: PacoteTela) =>
  `pacote ${i + 1}: ${k.conta}, ${k.justificativa.length > TRECHO ? `${k.justificativa.slice(0, TRECHO).trimEnd()}…` : k.justificativa}`;

export type PermissoesPacote = { podeIncluir: boolean; podeAlterar: boolean; podeExcluir: boolean };

export function TelaPacotes({
  ano,
  exercicioId,
  opcoes,
  lista,
  ccAtual,
  emEdicao,
  permissoes,
  acoes,
  aviso,
  iaJustificativa = false,
  iaSugestaoConta = false,
  gravacao,
}: {
  ano: number;
  exercicioId: string;
  opcoes: OpcoesPacote;
  lista: ListaPacotes;
  ccAtual: string | null;
  emEdicao: string | null;
  permissoes: PermissoesPacote;
  acoes: { incluir: AcaoFormulario; alterar: AcaoFormulario; excluir: AcaoFormulario; sugerirJustificativa?: AcaoSugerirJustificativa; sugerirContaCc?: AcaoSugerirContaCc };
  aviso?: string | undefined;
  // Ajuda da IA na justificativa (US-063): a página decide pela permissão do caso (D-P14-5).
  iaJustificativa?: boolean;
  // Sugestão de conta e CC (US-062): a página decide por iaLiberada(ctx, 'sugestaoConta') (D-P14-5).
  iaSugestaoConta?: boolean;
  // Id da última gravação (?salvo=): muda a key do formulário de inclusão, que recomeça do zero.
  gravacao?: string | undefined;
}) {
  // CCs da escolha: os do escopo e, para quem vê tudo, os dos pacotes de CC fora da estrutura ativa.
  const ccsComPacote = [...new Set(lista.pacotes.map((k) => k.cc))].filter((cc) => !opcoes.ccs.some((c) => c.classificacao === cc));
  const ccs = [...opcoes.ccs, ...ccsComPacote.map((cc) => ({ classificacao: cc, descricao: MENSAGENS_ORC.CC_DESCONHECIDO }))];
  const pacotes = lista.pacotes.filter((k) => k.cc === ccAtual);
  const rota = (extra: string) => `/orc/pacotes?ano=${ano}&cc=${encodeURIComponent(ccAtual ?? '')}${extra}`;
  const editavel = lista.editavel;
  const acoesNaLinha = editavel && (permissoes.podeAlterar || permissoes.podeExcluir);
  const editando = editavel && permissoes.podeAlterar ? (pacotes.find((k) => k.id === emEdicao) ?? null) : null;
  const totalCc = pacotes.length > 0 ? Dinheiro.somarTodos(pacotes.map((k) => k.valorAnual)) : null;
  const sugerirJustificativa = iaJustificativa ? acoes.sugerirJustificativa : undefined;
  const sugerirContaCc = iaSugestaoConta ? acoes.sugerirContaCc : undefined;
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {!editavel && <p>{MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(opcoes.rotuloSituacao)}</p>}
      {ccs.length === 0 ? (
        <p>Nenhum centro de custo disponível no seu escopo.</p>
      ) : (
        <form method="get" action="/orc/pacotes">
          <input type="hidden" name="ano" value={ano} />
          <label htmlFor="pacotes-cc">Centro de custo</label>
          <select id="pacotes-cc" name="cc" defaultValue={ccAtual ?? undefined}>
            {ccs.map((c) => (
              <option key={c.classificacao} value={c.classificacao}>{`${c.classificacao} – ${c.descricao}`}</option>
            ))}
          </select>
          <button type="submit">Ver pacotes</button>
        </form>
      )}
      {ccAtual && (
        <section aria-labelledby="pacotes-lista">
          <h2 id="pacotes-lista">{`Pacotes do CC ${ccAtual}`}</h2>
          {pacotes.length === 0 ? (
            <p>Nenhum pacote neste centro de custo.</p>
          ) : (
            <div role="region" aria-labelledby="pacotes-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
              <table>
                <caption id="pacotes-caption">{`Pacotes base zero do CC ${ccAtual} em ${ano}, valores em R$`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Conta</th>
                    <th scope="col">Justificativa</th>
                    <th scope="col">Prioridade</th>
                    <th scope="col">Valor anual</th>
                    <th scope="col">Distribuição</th>
                    <th scope="col">Origem</th>
                    {acoesNaLinha && <th scope="col">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {pacotes.map((k, i) => {
                    const destacada = editando?.id === k.id;
                    return (
                      <tr key={k.id} aria-current={destacada ? 'true' : undefined} className={destacada ? 'em-edicao' : undefined} style={destacada ? { outline: '2px solid currentColor' } : undefined}>
                        <th scope="row">{k.conta}</th>
                        <td>{k.justificativa}</td>
                        <td>{PRIORIDADE[k.prioridade] ?? k.prioridade}</td>
                        <td>{valorParaTela(k.valorAnual)}</td>
                        <td>{distribuicao(k)}</td>
                        <td>{ORIGEM[k.origem] ?? k.origem}</td>
                        {acoesNaLinha && (
                          <td>
                            {permissoes.podeAlterar && <a href={rota(`&editar=${k.id}#form-pacote`)}>{`Alterar ${descreverPacote(i, k)}`}</a>}
                            {permissoes.podeExcluir && (
                              <AcaoConfirmada
                                rotulo={`Excluir ${descreverPacote(i, k)}`}
                                pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_PACOTE(k.conta, k.cc)}
                                acao={acoes.excluir}
                                campos={{ id: k.id, versao: String(k.versao) }}
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
                      <th scope="row" colSpan={3}>
                        Total do CC
                      </th>
                      <td>{valorParaTela(totalCc)}</td>
                      <td colSpan={acoesNaLinha ? 3 : 2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>
      )}
      {editavel && ccAtual && (
        <div id="form-pacote">
          {editando ? (
            <FormPacote
              key={editando.id}
              ano={ano}
              exercicioId={exercicioId}
              ccAtual={ccAtual}
              ccs={opcoes.ccs}
              contas={opcoes.contas}
              ipca={opcoes.ipca}
              quantidadeMaxima={opcoes.quantidadeMaxima}
              pacote={{
                id: editando.id,
                cc: editando.cc,
                conta: editando.conta,
                justificativa: editando.justificativa,
                prioridade: editando.prioridade,
                quantidade: String(editando.quantidade),
                valorUnitario: valorParaTela(editando.valorUnitario),
                corrigirIpca: editando.corrigirIpca,
                distribuicao: editando.distribuicao,
                mesOcorrencia: editando.mesOcorrencia === null ? '' : String(editando.mesOcorrencia),
                versao: editando.versao,
              }}
              avisoOrigem={AVISO_ORIGEM[editando.origem]}
              salvar={acoes.alterar}
              cancelarPara={rota('')}
              sugerirJustificativa={sugerirJustificativa}
              sugerirContaCc={sugerirContaCc}
            />
          ) : (
            permissoes.podeIncluir &&
            opcoes.ccs.some((c) => c.classificacao === ccAtual) && (
              <FormPacote
                key={`novo-${ccAtual}-${gravacao ?? ''}`}
                ano={ano}
                exercicioId={exercicioId}
                ccAtual={ccAtual}
                ccs={opcoes.ccs}
                contas={opcoes.contas}
                ipca={opcoes.ipca}
                quantidadeMaxima={opcoes.quantidadeMaxima}
                salvar={acoes.incluir}
                cancelarPara={rota('')}
                sugerirJustificativa={sugerirJustificativa}
                sugerirContaCc={sugerirContaCc}
              />
            )
          )}
        </div>
      )}
    </>
  );
}
