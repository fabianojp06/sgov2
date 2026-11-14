import { AcaoConfirmada, type AcaoFormulario } from "@/modules/ger";
import type { Dinheiro } from "@/shared/kernel";
import type {
  OpcoesViagem,
  BlocoViagens,
  FiltrosViagens,
  GrupoViagens,
} from "../application/viagens";
import { MENSAGENS_ORC } from "../domain/mensagens";
import {
  ROTULO_SITUACAO_PROPOSTA,
  ROTULO_TIPO_PROPOSTA,
} from "../domain/proposta";
import { valorParaTela } from "../domain/valor-tela";
import { LIMITE_LOCALIDADE } from "../domain/viagem";
import { FiltrosPessoalProposta } from "./filtros-pessoal";
import { FormTetoViagem } from "./form-teto-viagem";
import { FormViagem } from "./form-viagem";
import type { PermissoesPessoal } from "./tela-empregados";

// Tela das viagens da proposta (US-071; Viagens V3, UC03.29 a UC03.33; plano do P21, Task 2 e D-P21-11). Server
// Component: os filtros num formulário GET (REQ_VIA_001) e um bloco por proposta com a última versão. Cada
// bloco tem a Camada 1 (tetos por conta sintética, com o consumido e o saldo), o painel (cartões, composição
// e ranking por localidade, REQ_VIA_004 a 006) e a grade das viagens, por meta na categoria Meta (REQ_VIA_002).
// Os formulários abrem pela URL, acima da lista: ?nova=, ?copiar= e ?editar= (viagem); ?novoTeto= e
// ?editarTeto= (teto). As barras do ranking são proporcionais ao maior custo, sem biblioteca de gráfico.

const LIMITE_CONTA = 64;

/** Aviso depois de uma operação, com a localidade (?l=) ou a conta (?c=) vindas da ação. */
export function textoAvisoViagem(
  aviso: string | undefined,
  localidade: string | undefined,
  conta: string | undefined,
): string | undefined {
  if (localidade && [...localidade].length <= LIMITE_LOCALIDADE) {
    if (aviso === "incluida") return MENSAGENS_ORC.VIAGEM_INCLUIDA(localidade);
    if (aviso === "alterada") return MENSAGENS_ORC.VIAGEM_ALTERADA(localidade);
    if (aviso === "excluida") return MENSAGENS_ORC.VIAGEM_EXCLUIDA(localidade);
  }
  if (conta && conta.length <= LIMITE_CONTA && /^[\d.]+$/.test(conta)) {
    if (aviso === "teto-incluido") return MENSAGENS_ORC.TETO_INCLUIDO(conta);
    if (aviso === "teto-alterado") return MENSAGENS_ORC.TETO_ALTERADO(conta);
    if (aviso === "teto-excluido") return MENSAGENS_ORC.TETO_EXCLUIDO(conta);
  }
  return undefined;
}

export type FormularioViagemAberto =
  | { modo: "incluir"; propostaId: string }
  | { modo: "copiar"; id: string }
  | { modo: "alterar"; id: string }
  | { modo: "incluirTeto"; propostaId: string }
  | { modo: "alterarTeto"; id: string };

export type AcoesViagens = {
  incluir: AcaoFormulario;
  alterar: AcaoFormulario;
  excluir: AcaoFormulario;
  incluirTeto: AcaoFormulario;
  alterarTeto: AcaoFormulario;
  excluirTeto: AcaoFormulario;
};

const proporcao = (valor: Dinheiro, maior: Dinheiro) =>
  maior.ehZero()
    ? 0
    : Math.round(
        (Number(valor.paraString()) / Number(maior.paraString())) * 100,
      );

function Barra({ valor, maior }: { valor: Dinheiro; maior: Dinheiro }) {
  return (
    <span
      aria-hidden="true"
      className="barra"
      style={{
        display: "inline-block",
        height: "0.8em",
        width: `${proporcao(valor, maior)}%`,
        background: "currentColor",
      }}
    />
  );
}

function Camada1({
  bloco,
  permissoes,
  excluir,
}: {
  bloco: BlocoViagens;
  permissoes: PermissoesPessoal;
  excluir: AcaoFormulario;
}) {
  const titulo = `tetos-${bloco.propostaId}`;
  const podeAlterar = permissoes.podeAlterar && bloco.editavel;
  const podeExcluir = permissoes.podeExcluir && bloco.editavel;
  return (
    <div
      role="region"
      aria-labelledby={`${titulo}-caption`}
      tabIndex={0}
      style={{ overflowX: "auto" }}
    >
      <table>
        <caption
          id={`${titulo}-caption`}
        >{`Teto por conta sintética da proposta ${bloco.numero}, em R$`}</caption>
        <thead>
          <tr>
            <th scope="col">Conta sintética</th>
            <th scope="col">Teto da conta</th>
            <th scope="col">Total consumido</th>
            <th scope="col">Saldo</th>
            {(podeAlterar || podeExcluir) && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {bloco.tetos.map((t) => (
            <tr key={t.id}>
              <th scope="row">{`${t.contaSintetica} – ${t.descricao}`}</th>
              <td>{valorParaTela(t.valor)}</td>
              <td>{valorParaTela(t.consumido)}</td>
              <td>{valorParaTela(t.saldo)}</td>
              {(podeAlterar || podeExcluir) && (
                <td>
                  {podeAlterar && (
                    <a
                      href={`/orc/viagens?editarTeto=${t.id}`}
                    >{`Editar o teto da conta ${t.contaSintetica}`}</a>
                  )}
                  {podeExcluir && (
                    <AcaoConfirmada
                      rotulo={`Excluir o teto da conta ${t.contaSintetica}`}
                      pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_TETO}
                      acao={excluir}
                      campos={{
                        id: t.id,
                        versao: String(t.versao),
                        versaoCapa: String(bloco.versaoCapa),
                      }}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Painel({ bloco }: { bloco: BlocoViagens }) {
  const i = bloco.indicadores;
  const titulo = `painel-${bloco.propostaId}`;
  const composicao: [string, Dinheiro][] = [
    ["Passagem", i.passagens],
    ["Diária", i.diarias],
    ["Transporte", i.transportes],
  ];
  const maiorComposicao = composicao.reduce(
    (m, [, v]) => (v.comparar(m) > 0 ? v : m),
    composicao[0]![1],
  );
  const maiorRanking = i.ranking[0]?.custo;
  return (
    <section aria-labelledby={titulo}>
      <h3 id={titulo}>{`Painel das viagens da proposta ${bloco.numero}`}</h3>
      <dl>
        <dt>Nº de viagens</dt>
        <dd>{i.quantidade}</dd>
        <dt>Custo total estimado</dt>
        <dd>{i.custoTotal.formatar()}</dd>
        <dt>Custo médio por viagem</dt>
        <dd>{i.custoMedio ? i.custoMedio.formatar() : "—"}</dd>
        <dt>Total de pessoas-viagem</dt>
        <dd>{i.pessoas}</dd>
        <dt>Total de passagens</dt>
        <dd>{i.passagens.formatar()}</dd>
        <dt>Total de diárias</dt>
        <dd>{i.diarias.formatar()}</dd>
        <dt>Total de transporte</dt>
        <dd>{i.transportes.formatar()}</dd>
        <dt>Total geral</dt>
        <dd>{i.totalGeral.formatar()}</dd>
      </dl>
      {i.ranking.length > 0 && (
        <table>
          <caption>
            Ranking de viagens por localidade – custo estimado, em R$
          </caption>
          <thead>
            <tr>
              <th scope="col">Localidade</th>
              <th scope="col">Custo estimado</th>
              <th scope="col">Proporção</th>
            </tr>
          </thead>
          <tbody>
            {i.ranking.map((r) => (
              <tr key={r.localidade}>
                <th scope="row">{r.localidade}</th>
                <td>{valorParaTela(r.custo)}</td>
                <td>
                  <Barra valor={r.custo} maior={maiorRanking!} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table>
        <caption>
          Composição de custo – passagem × diária × transporte, em R$
        </caption>
        <thead>
          <tr>
            <th scope="col">Categoria</th>
            <th scope="col">Total</th>
            <th scope="col">Proporção</th>
          </tr>
        </thead>
        <tbody>
          {composicao.map(([rotulo, v]) => (
            <tr key={rotulo}>
              <th scope="row">{rotulo}</th>
              <td>{valorParaTela(v)}</td>
              <td>
                <Barra valor={v} maior={maiorComposicao} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Grupo({
  bloco,
  grupo,
  permissoes,
  excluir,
}: {
  bloco: BlocoViagens;
  grupo: GrupoViagens;
  permissoes: PermissoesPessoal;
  excluir: AcaoFormulario;
}) {
  const titulo = `viagens-${bloco.propostaId}-${grupo.metaId ?? "sem-meta"}`;
  const podeAlterar = permissoes.podeAlterar && bloco.editavel;
  const podeCopiar = permissoes.podeIncluir && bloco.editavel;
  const podeExcluir = permissoes.podeExcluir && bloco.editavel;
  const comAcoes = podeAlterar || podeCopiar || podeExcluir;
  const legenda = grupo.metaNumero
    ? `Meta ${grupo.metaNumero} – ${grupo.metaNome}`
    : `Viagens da proposta ${bloco.numero}`;
  return (
    <div
      role="region"
      aria-labelledby={`${titulo}-caption`}
      tabIndex={0}
      style={{ overflowX: "auto" }}
    >
      <table>
        <caption id={`${titulo}-caption`}>{`${legenda}, custos em R$`}</caption>
        <thead>
          <tr>
            <th scope="col">Localidade</th>
            <th scope="col">Pessoas</th>
            <th scope="col">Média de dias</th>
            <th scope="col">Custo unitário de passagem</th>
            <th scope="col">Custo unitário de diária</th>
            <th scope="col">Custo unitário de transporte</th>
            <th scope="col">Custo estimado</th>
            {comAcoes && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {grupo.viagens.map((v) => (
            <tr key={v.id}>
              <th scope="row">{v.localidade}</th>
              <td>{v.pessoas}</td>
              <td>{v.dias}</td>
              <td>{valorParaTela(v.valorPassagem)}</td>
              <td>{valorParaTela(v.valorDiaria)}</td>
              <td>{valorParaTela(v.valorTransporte)}</td>
              <td>{valorParaTela(v.custo.estimado)}</td>
              {comAcoes && (
                <td>
                  {podeAlterar && (
                    <a
                      href={`/orc/viagens?editar=${v.id}`}
                    >{`Editar a viagem para ${v.localidade}`}</a>
                  )}{" "}
                  {podeCopiar && (
                    <a
                      href={`/orc/viagens?copiar=${v.id}`}
                    >{`Copiar a viagem para ${v.localidade}`}</a>
                  )}
                  {podeExcluir && (
                    <AcaoConfirmada
                      rotulo={`Excluir a viagem para ${v.localidade}`}
                      pergunta={MENSAGENS_ORC.CONFIRMA_EXCLUSAO_VIAGEM}
                      acao={excluir}
                      campos={{
                        id: v.id,
                        versao: String(v.versao),
                        versaoCapa: String(bloco.versaoCapa),
                      }}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bloco({
  bloco,
  permissoes,
  acoes,
}: {
  bloco: BlocoViagens;
  permissoes: PermissoesPessoal;
  acoes: AcoesViagens;
}) {
  const titulo = `viagens-${bloco.propostaId}`;
  const semMetaAtiva = bloco.categoria === "META" && bloco.metas.length === 0;
  const podeIncluir = permissoes.podeIncluir && bloco.editavel;
  return (
    <section aria-labelledby={titulo}>
      <h2 id={titulo}>{`${bloco.numero} – ${bloco.objeto}`}</h2>
      <p>
        {`${ROTULO_TIPO_PROPOSTA[bloco.tipo]} · Versão ${bloco.versaoNumero} `}
        <span className="selo">{ROTULO_SITUACAO_PROPOSTA[bloco.situacao]}</span>
      </p>
      {bloco.tetos.length === 0 ? (
        <p>Nenhum teto de viagens nesta versão.</p>
      ) : (
        <Camada1
          bloco={bloco}
          permissoes={permissoes}
          excluir={acoes.excluirTeto}
        />
      )}
      {podeIncluir && (
        <a
          href={`/orc/viagens?novoTeto=${bloco.propostaId}`}
        >{`Novo teto de viagens na proposta ${bloco.numero}`}</a>
      )}
      <Painel bloco={bloco} />
      {bloco.grupos.length === 0 ? (
        <p>Nenhuma viagem nesta versão.</p>
      ) : (
        bloco.grupos.map((g) => (
          <Grupo
            key={g.metaId ?? "sem-meta"}
            bloco={bloco}
            grupo={g}
            permissoes={permissoes}
            excluir={acoes.excluir}
          />
        ))
      )}
      {podeIncluir &&
        (semMetaAtiva ? (
          <p role="note">
            Cadastre uma meta ativa na proposta antes de lançar viagens.{" "}
            <a href="/orc/metas">Ir para as metas</a>
          </p>
        ) : bloco.tetos.length === 0 ? (
          <p role="note">
            Cadastre o teto de uma conta sintética antes de lançar viagens.
          </p>
        ) : (
          <a
            href={`/orc/viagens?nova=${bloco.propostaId}`}
          >{`Nova viagem na proposta ${bloco.numero}`}</a>
        ))}
    </section>
  );
}

export function TelaViagens({
  blocos,
  filtros,
  permissoes,
  acoes,
  opcoes,
  aviso,
  formulario,
}: {
  blocos: readonly BlocoViagens[];
  filtros: FiltrosViagens;
  permissoes: PermissoesPessoal;
  acoes: AcoesViagens;
  opcoes: OpcoesViagem | null;
  aviso?: string | undefined;
  formulario?: FormularioViagemAberto | null | undefined;
}) {
  const editaveis = blocos.filter((b) => b.editavel);
  const viagens = editaveis.flatMap((b) =>
    b.grupos.flatMap((g) => g.viagens.map((v) => ({ bloco: b, viagem: v }))),
  );
  const aberto = (() => {
    if (!formulario || !opcoes) return null;
    if (formulario.modo === "incluir" && permissoes.podeIncluir) {
      const b = editaveis.find(
        (x) =>
          x.propostaId === formulario.propostaId &&
          x.tetos.length > 0 &&
          !(x.categoria === "META" && x.metas.length === 0),
      );
      return b ? (
        <FormViagem
          bloco={b}
          modo={{ modo: "incluir" }}
          contas={opcoes.analiticas}
          salvar={acoes.incluir}
        />
      ) : null;
    }
    if (formulario.modo === "copiar" && permissoes.podeIncluir) {
      const x = viagens.find((y) => y.viagem.id === formulario.id);
      return x ? (
        <FormViagem
          bloco={x.bloco}
          modo={{ modo: "copiar", origem: x.viagem }}
          contas={opcoes.analiticas}
          salvar={acoes.incluir}
        />
      ) : null;
    }
    if (formulario.modo === "alterar" && permissoes.podeAlterar) {
      const x = viagens.find((y) => y.viagem.id === formulario.id);
      return x ? (
        <FormViagem
          bloco={x.bloco}
          modo={{ modo: "alterar", viagem: x.viagem }}
          contas={opcoes.analiticas}
          salvar={acoes.alterar}
        />
      ) : null;
    }
    if (formulario.modo === "incluirTeto" && permissoes.podeIncluir) {
      const b = editaveis.find((x) => x.propostaId === formulario.propostaId);
      return b ? (
        <FormTetoViagem
          bloco={b}
          sinteticas={opcoes.sinteticas}
          salvar={acoes.incluirTeto}
        />
      ) : null;
    }
    if (formulario.modo === "alterarTeto" && permissoes.podeAlterar) {
      const b = editaveis.find((x) =>
        x.tetos.some((t) => t.id === formulario.id),
      );
      const t = b?.tetos.find((y) => y.id === formulario.id);
      return b && t ? (
        <FormTetoViagem
          bloco={b}
          teto={t}
          sinteticas={opcoes.sinteticas}
          salvar={acoes.alterarTeto}
        />
      ) : null;
    }
    return null;
  })();
  const naoAbriu =
    formulario && !aberto
      ? formulario.modo === "incluir" || formulario.modo === "incluirTeto"
        ? MENSAGENS_ORC.PROPOSTA_INEXISTENTE
        : formulario.modo === "alterarTeto"
          ? MENSAGENS_ORC.TETO_INEXISTENTE
          : MENSAGENS_ORC.VIAGEM_INEXISTENTE
      : undefined;
  return (
    <>
      {aviso && <p role="status">{aviso}</p>}
      {naoAbriu && <p role="status">{naoAbriu}</p>}
      {aberto}
      <FiltrosPessoalProposta
        rota="/orc/viagens"
        rotulo="Pesquisar viagens"
        prefixo="viagens"
        filtros={filtros}
      />
      {blocos.length === 0 ? (
        <p>Nenhuma proposta encontrada nos seus Termos de Parceria.</p>
      ) : (
        blocos.map((b) => (
          <Bloco
            key={b.propostaId}
            bloco={b}
            permissoes={permissoes}
            acoes={acoes}
          />
        ))
      )}
    </>
  );
}
