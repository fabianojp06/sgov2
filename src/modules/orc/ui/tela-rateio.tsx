import { AcaoConfirmada, ErroDoCampo, Formulario, type AcaoFormulario } from '@/modules/ger';
import type { LinhaRateio, PropostaParaRateio, RateioTela } from '../application/rateio';
import { MENSAGENS_ORC } from '../domain/mensagens';
import { ROTULO_SITUACAO_PROPOSTA, ROTULO_TIPO_PROPOSTA } from '../domain/proposta';
import { campoCelula, campoConta, MAXIMO_LINHAS_RATEIO, MODOS_RATEIO, ROTULO_MODO_RATEIO, type ModoRateio } from '../domain/rateio';
import { valorParaTela } from '../domain/valor-tela';
import { mesAno } from './filtros-pessoal';

// Tela de Rateio/ISS da proposta (US-073; UC03.03; plano do P24, Task 2). A grade é um formulário com a conta
// sintética mandante, o modo, a alíquota de ISS (só no Contrato) e uma linha por conta de destino, com um campo
// por competência da vigência (REQ_RAT_001); salva inteira. A base é só leitura (RN_RAT_06) e fica restrita a
// quem não vê o pessoal (D-P24-2). O Replicar (C1 da #95) e a exclusão são ações próprias, por linha e da grade.

export function textoAvisoRateio(aviso: string | undefined, numero: string, conta: string | undefined): string | undefined {
  if (aviso === 'salvo') return MENSAGENS_ORC.RATEIO_SALVO(numero);
  if (aviso === 'excluido') return MENSAGENS_ORC.RATEIO_EXCLUIDO(numero);
  if (aviso === 'replicado' && conta && /^[\d.]{1,64}$/.test(conta)) return MENSAGENS_ORC.RATEIO_REPLICADO(conta);
  return undefined;
}

export type PermissoesRateio = { podeSalvar: boolean; podeAlterar: boolean; podeExcluir: boolean };
export type AcoesRateio = { salvar: AcaoFormulario; replicar: AcaoFormulario; excluir: AcaoFormulario };

/** O texto da célula no modo da grade: o % (com vírgula) ou o valor (formato da tela). */
const textoCelula = (modo: ModoRateio, c: { valor: Parameters<typeof valorParaTela>[0]; percentual: { paraString(): string } | null } | undefined) =>
  !c ? '' : modo === 'PERCENTUAL' && c.percentual ? c.percentual.paraString().replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') : valorParaTela(c.valor);

function Escolha({ propostas }: { propostas: readonly PropostaParaRateio[] }) {
  return (
    <section aria-labelledby="rateio-escolha">
      <h2 id="rateio-escolha">Escolha a proposta</h2>
      {propostas.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        <ul>
          {propostas.map((p) => (
            <li key={p.id}>
              <a href={`/orc/rateio?proposta=${p.id}`}>{`Rateio/ISS da proposta ${p.numero} – ${p.objeto}`}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Resumo({ dados }: { dados: RateioTela }) {
  const g = dados.grade!;
  return (
    <dl>
      <dt>Conta sintética mandante</dt>
      <dd>{`${g.contaSintetica} – ${g.descricaoSintetica}`}</dd>
      <dt>Base (orçado da conta mandante)</dt>
      <dd>{dados.base ? dados.base.formatar() : MENSAGENS_ORC.RATEIO_BASE_RESTRITA}</dd>
      <dt>Total distribuído</dt>
      <dd>{g.total.formatar()}</dd>
      {dados.base && (
        <>
          <dt>Saldo da base</dt>
          <dd>{dados.base.subtrair(g.total).formatar()}</dd>
        </>
      )}
      <dt>Tipo de distribuição</dt>
      <dd>{ROTULO_MODO_RATEIO[g.modo]}</dd>
      {dados.tipo === 'CONTRATO' && (
        <>
          <dt>ISS</dt>
          <dd>{`${g.aliquotaIss ? g.aliquotaIss.formatar() : '—'} · ${MENSAGENS_ORC.RATEIO_ISS_A_DEFINIR}`}</dd>
        </>
      )}
      {dados.tipo === 'TERMO_PARCERIA' && (
        <>
          <dt>ISS</dt>
          <dd>Termo de Parceria: imune.</dd>
        </>
      )}
    </dl>
  );
}

function Grade({ dados, acoes }: { dados: RateioTela; acoes: AcoesRateio }) {
  const g = dados.grade;
  const modo: ModoRateio = g?.modo ?? 'VALOR';
  const vazia: Pick<LinhaRateio, 'conta' | 'celulas'> = { conta: '', celulas: {} };
  const linhas: Pick<LinhaRateio, 'conta' | 'celulas'>[] = [...(g?.linhas ?? []), vazia, vazia].slice(0, MAXIMO_LINHAS_RATEIO);
  return (
    <section aria-labelledby="rateio-form">
      <h3 id="rateio-form">{g ? 'Alterar a grade' : 'Nova grade de rateio'}</h3>
      <Formulario acao={acoes.salvar} textoEnviar="Salvar grade">
        <input type="hidden" name="propostaId" value={dados.propostaId} />
        <input type="hidden" name="versaoCapa" value={String(dados.versaoCapa)} />
        <input type="hidden" name="modoAnterior" value={modo} />
        <p>
          <label htmlFor="rateio-sintetica">Conta sintética mandante (base)</label>
          <select id="rateio-sintetica" name="contaSintetica" defaultValue={g?.contaSintetica ?? ''} aria-required="true" aria-describedby="erro-contaSintetica">
            <option value="" disabled>
              Escolha a conta sintética
            </option>
            {dados.opcoes.sinteticas.map((c) => (
              <option key={c.classificacao} value={c.classificacao}>
                {`${c.classificacao} – ${c.descricao}`}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="contaSintetica" />
        </p>
        <p>
          <label htmlFor="rateio-modo">Tipo de distribuição</label>
          <select id="rateio-modo" name="modo" defaultValue={modo} aria-describedby="erro-modo">
            {MODOS_RATEIO.map((m) => (
              <option key={m} value={m}>
                {ROTULO_MODO_RATEIO[m]}
              </option>
            ))}
          </select>
          <ErroDoCampo campo="modo" />
          <small> Ao trocar o tipo, os valores digitados são convertidos pela base ao salvar.</small>
        </p>
        {dados.tipo === 'CONTRATO' && (
          <p>
            <label htmlFor="rateio-iss">Alíquota de ISS (%)</label>
            <input
              id="rateio-iss"
              name="aliquotaIss"
              inputMode="decimal"
              aria-required="true"
              aria-describedby="erro-aliquotaIss"
              defaultValue={g?.aliquotaIss ? g.aliquotaIss.paraString().replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') : undefined}
            />
            <ErroDoCampo campo="aliquotaIss" />
          </p>
        )}
        <div role="region" aria-labelledby="rateio-grade-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table>
            <caption id="rateio-grade-caption">{`Distribuição por competência (${modo === 'PERCENTUAL' ? '% da base' : 'R$'})`}</caption>
            <thead>
              <tr>
                <th scope="col">Conta analítica de destino</th>
                {dados.competencias.map((c) => (
                  <th key={c} scope="col">
                    {mesAno(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={`${i}-${l.conta}`}>
                  <th scope="row">
                    <label htmlFor={`rateio-${campoConta(i)}`} className="sr-only">{`Conta da linha ${i + 1}`}</label>
                    <select id={`rateio-${campoConta(i)}`} name={campoConta(i)} defaultValue={l.conta} aria-describedby={`erro-${campoConta(i)}`}>
                      <option value="">—</option>
                      {dados.opcoes.analiticas.map((c) => (
                        <option key={c.classificacao} value={c.classificacao}>
                          {`${c.classificacao} – ${c.descricao}`}
                        </option>
                      ))}
                    </select>
                    <ErroDoCampo campo={campoConta(i)} />
                  </th>
                  {dados.competencias.map((comp) => (
                    <td key={comp}>
                      <input
                        name={campoCelula(i, comp)}
                        aria-label={`Linha ${i + 1}, ${mesAno(comp)}`}
                        inputMode="decimal"
                        size={9}
                        defaultValue={textoCelula(modo, l.celulas[comp])}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Formulario>
    </section>
  );
}

function Leitura({ dados, permissoes, acoes }: { dados: RateioTela; permissoes: PermissoesRateio; acoes: AcoesRateio }) {
  const g = dados.grade!;
  const podeReplicar = permissoes.podeAlterar && dados.editavel;
  return (
    <div role="region" aria-labelledby="rateio-leitura-caption" tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption id="rateio-leitura-caption">{`Rateio da proposta ${dados.numero} por conta e competência, em R$`}</caption>
        <thead>
          <tr>
            <th scope="col">Conta</th>
            {dados.competencias.map((c) => (
              <th key={c} scope="col">
                {mesAno(c)}
              </th>
            ))}
            <th scope="col">Total</th>
            {podeReplicar && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {g.linhas.map((l) => (
            <tr key={l.conta}>
              <th scope="row">{`${l.conta} – ${l.descricao}`}</th>
              {dados.competencias.map((c) => (
                <td key={c}>{l.celulas[c] ? valorParaTela(l.celulas[c].valor) : '0,00'}</td>
              ))}
              <td>{valorParaTela(l.total)}</td>
              {podeReplicar && (
                <td>
                  <AcaoConfirmada
                    rotulo={`Replicar o primeiro mês da conta ${l.conta}`}
                    pergunta={MENSAGENS_ORC.CONFIRMA_REPLICAR_RATEIO}
                    acao={acoes.replicar}
                    campos={{ propostaId: dados.propostaId, versaoCapa: String(dados.versaoCapa), conta: l.conta }}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TelaRateio({
  dados,
  propostas,
  permissoes,
  acoes,
  aviso,
}: {
  dados: RateioTela | null;
  propostas: readonly PropostaParaRateio[];
  permissoes: PermissoesRateio;
  acoes: AcoesRateio;
  aviso?: string | undefined;
}) {
  if (!dados) return <Escolha propostas={propostas} />;
  const podeEditar = dados.editavel && (dados.grade ? permissoes.podeAlterar : permissoes.podeSalvar);
  return (
    <section aria-labelledby="rateio-titulo">
      {aviso && <p role="status">{aviso}</p>}
      <h2 id="rateio-titulo">{`${dados.numero} – ${dados.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[dados.tipo]} · Versão ${dados.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[dados.situacao]}</span>
      </p>
      {dados.grade ? (
        <>
          <Resumo dados={dados} />
          <Leitura dados={dados} permissoes={permissoes} acoes={acoes} />
          {permissoes.podeExcluir && dados.editavel && (
            <AcaoConfirmada
              rotulo={`Excluir a grade de rateio da proposta ${dados.numero}`}
              pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_RATEIO}
              acao={acoes.excluir}
              campos={{ propostaId: dados.propostaId, versaoCapa: String(dados.versaoCapa) }}
            />
          )}
        </>
      ) : (
        <p>Esta versão ainda não tem grade de rateio.</p>
      )}
      {podeEditar && <Grade dados={dados} acoes={acoes} />}
      <p>
        <a href="/orc/rateio">Escolher outra proposta</a>
      </p>
    </section>
  );
}
