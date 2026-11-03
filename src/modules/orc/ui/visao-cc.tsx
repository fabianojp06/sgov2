import { GradeArvore, type ColunaGrade, type NoGrade } from '@/modules/ger';
import { Dinheiro, type Percentual } from '@/shared/kernel';
import { valorParaTela } from '../domain/valor-tela';
import { AcaoConfirmada, type AcaoFormulario } from './acao-confirmada';
import { FormTeto } from './form-teto';
import { PainelTeto, type DadosPainel } from './painel-teto';

// Visão por centro de custo (US-058, §6.6): indicadores do escopo, árvore de CC (C3) com pessoal +
// encargos, base zero, total e % do escopo, e o detalhe do CC escolhido com a série mês a mês e as
// linhas CC × conta com a origem. Server Component; a grade é o componente cliente do ger.
type No = {
  cc: string;
  codigoReduzido: string;
  descricao: string;
  inativo: boolean;
  pessoal: Dinheiro;
  baseZero: Dinheiro;
  total: Dinheiro;
  percentualDoEscopo: Percentual | null;
  filhos: readonly No[];
};
type Linha = { conta: string; descricaoConta: string; origem: 'PESSOAL' | 'BASE_ZERO'; meses: readonly Dinheiro[]; total: Dinheiro };
export type DadosVisao = {
  exercicio: { id: string; ano: number; rotuloSituacao: string; editavel: boolean; versao: number };
  painel: DadosPainel | null;
  escopo: { tipo: 'TOTAL' } | { tipo: 'SUBARVORE'; raiz: string };
  arvore: readonly No[];
  indicadores: {
    orcamentoAno: Dinheiro;
    pessoal: Dinheiro;
    percentualPessoal: Percentual | null;
    pacotes: number;
    empregadosDezembro: number;
    porPrioridade: Readonly<Record<'ESSENCIAL' | 'IMPORTANTE' | 'DESEJAVEL', Dinheiro>>;
  };
  detalhe: { cc: string; codigoReduzido: string; descricao: string; serie: { pessoal: readonly Dinheiro[]; baseZero: readonly Dinheiro[]; total: readonly Dinheiro[] }; linhas: readonly Linha[] } | null;
  avisos: readonly string[];
};

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ORIGEM = { PESSOAL: 'Pessoal', BASE_ZERO: 'Base zero' } as const;
const pct = (p: Percentual | null) => (p ? p.formatar() : '—');

type Campos = 'cc' | 'pessoal' | 'baseZero' | 'total' | 'percentual';
const COLUNAS: readonly ColunaGrade<Campos>[] = [
  { campo: 'cc', titulo: 'Centro de custo', tipo: 'texto' },
  { campo: 'pessoal', titulo: 'Pessoal + encargos', tipo: 'dinheiro', largura: 160 },
  { campo: 'baseZero', titulo: 'Base zero', tipo: 'dinheiro', largura: 140 },
  { campo: 'total', titulo: 'Total', tipo: 'dinheiro', largura: 160 },
  { campo: 'percentual', titulo: '% do escopo', tipo: 'percentual', largura: 110 },
];

// O CC aparece sempre com o reduzido (§6.1a), e o inativo com o selo.
export function rotuloCc(n: Pick<No, 'cc' | 'codigoReduzido' | 'descricao' | 'inativo'>): string {
  const base = n.codigoReduzido ? `${n.codigoReduzido} · ${n.cc} ${n.descricao}` : `${n.cc} ${n.descricao}`;
  return n.inativo ? `${base} (Inativo)` : base;
}

function paraGrade(n: No, ano: number): NoGrade<Campos> {
  return {
    id: n.cc,
    linha: {
      cc: rotuloCc(n),
      pessoal: n.pessoal.paraString(),
      baseZero: n.baseZero.paraString(),
      total: n.total.paraString(),
      percentual: n.percentualDoEscopo?.paraString() ?? null,
    },
    // A âncora leva ao detalhe, que fica abaixo da grade.
    href: `/orc/orcamento?ano=${ano}&cc=${encodeURIComponent(n.cc)}#detalhe-cc`,
    filhos: n.filhos.map((f) => paraGrade(f, ano)),
  };
}

function TabelaSerie({ id, titulo, linhas }: { id: string; titulo: string; linhas: readonly { rotulo: string; meses: readonly Dinheiro[]; total: Dinheiro }[] }) {
  // Tabela larga (14 colunas): região rolável e focável, sem rolar a página inteira.
  return (
    <div role="region" aria-labelledby={id} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption id={id}>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">Linha</th>
            {MESES.map((m, i) => (
              <th key={m} scope="col">
                <abbr title={NOMES_MESES[i]}>{m}</abbr>
              </th>
            ))}
            <th scope="col">Ano</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo}>
              <th scope="row">{l.rotulo}</th>
              {l.meses.map((m, i) => (
                <td key={i}>{valorParaTela(m)}</td>
              ))}
              <td>{valorParaTela(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const soma = (xs: readonly Dinheiro[]) => Dinheiro.somarTodos(xs);

export function VisaoCc({
  visao,
  podeRecalcular,
  recalcular,
  podeDefinirTeto = false,
  definirTeto,
  aviso,
}: {
  visao: DadosVisao;
  podeRecalcular: boolean;
  recalcular: AcaoFormulario;
  podeDefinirTeto?: boolean;
  definirTeto?: AcaoFormulario;
  aviso?: string | undefined;
}) {
  const { exercicio, indicadores: i, detalhe } = visao;
  return (
    <>
      <p>{`Situação: ${exercicio.rotuloSituacao}${exercicio.editavel ? '' : ' (somente leitura)'}`}</p>
      {(aviso || visao.avisos.length > 0) && (
        <div role="status">
          {aviso && <p>{aviso}</p>}
          {visao.avisos.map((a, i) => (
            <p key={i}>{a}</p>
          ))}
        </div>
      )}
      {podeRecalcular && (
        <AcaoConfirmada
          rotulo="Recalcular"
          pergunta={`Deseja recalcular o orçamento ${exercicio.ano} com as premissas atuais?`}
          acao={recalcular}
          campos={{ exercicioId: exercicio.id }}
        />
      )}
      <section aria-labelledby="indicadores">
        <h2 id="indicadores">{visao.escopo.tipo === 'TOTAL' ? 'Indicadores' : `Indicadores do escopo (${visao.escopo.raiz})`}</h2>
        <dl>
          <dt>Orçamento do ano</dt>
          <dd>{`R$ ${valorParaTela(i.orcamentoAno)}`}</dd>
          <dt>Pessoal + encargos</dt>
          <dd>{`R$ ${valorParaTela(i.pessoal)} (${pct(i.percentualPessoal)} do total)`}</dd>
          <dt>Base zero</dt>
          <dd>{`${i.pacotes} pacote(s)`}</dd>
          <dt>Empregados em dezembro</dt>
          <dd>{i.empregadosDezembro}</dd>
          <dt>Base zero por prioridade</dt>
          <dd>{`Essencial R$ ${valorParaTela(i.porPrioridade.ESSENCIAL)} · Importante R$ ${valorParaTela(i.porPrioridade.IMPORTANTE)} · Desejável R$ ${valorParaTela(i.porPrioridade.DESEJAVEL)}`}</dd>
        </dl>
      </section>
      {visao.painel && <PainelTeto painel={visao.painel} />}
      {visao.painel && podeDefinirTeto && definirTeto && (
        <FormTeto
          exercicioId={exercicio.id}
          versao={exercicio.versao}
          tetoManual={visao.painel.tetoManual ? valorParaTela(visao.painel.tetoManual) : null}
          justificativa={visao.painel.justificativaTeto}
          salvar={definirTeto}
        />
      )}
      <section aria-labelledby="arvore-cc">
        <h2 id="arvore-cc">Por centro de custo</h2>
        <GradeArvore
          idGrade="orc.visao"
          rotulo={`Orçamento ${exercicio.ano} por centro de custo`}
          nos={visao.arvore.map((n) => paraGrade(n, exercicio.ano))}
          colunas={COLUNAS}
          expandidos="todos"
          textoVazio="Nenhum centro de custo no seu escopo."
        />
      </section>
      {detalhe && (
        <section aria-labelledby="detalhe-cc">
          <h2 id="detalhe-cc">{`Detalhe: ${rotuloCc({ ...detalhe, inativo: false })}`}</h2>
          <TabelaSerie
            id="tabela-serie"
            titulo="Série mês a mês (R$)"
            linhas={[
              { rotulo: 'Pessoal + encargos', meses: detalhe.serie.pessoal, total: soma(detalhe.serie.pessoal) },
              { rotulo: 'Base zero', meses: detalhe.serie.baseZero, total: soma(detalhe.serie.baseZero) },
              { rotulo: 'Total', meses: detalhe.serie.total, total: soma(detalhe.serie.total) },
            ]}
          />
          {detalhe.linhas.length === 0 ? (
            <p>Nenhum lançamento neste centro de custo.</p>
          ) : (
            <TabelaSerie
              id="tabela-linhas"
              titulo="Linhas CC × conta (R$)"
              linhas={detalhe.linhas.map((l) => ({ rotulo: `${ORIGEM[l.origem]} · ${l.conta} ${l.descricaoConta}`, meses: l.meses, total: l.total }))}
            />
          )}
        </section>
      )}
    </>
  );
}
