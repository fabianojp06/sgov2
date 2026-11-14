import { Dinheiro } from '@/shared/kernel';
import { INDICADORES, PESOS, type Comparativo, type Indicador, type MotivoPesosOmitidos, type TpComparado } from '../domain/comparativo-tps';

// O comparativo entre TPs (US-106) como a IA recebe: uma linha por TP, os indicadores, as medianas e as
// marcas de fora da curva (texto, não só cor). Componente puro, usado pela página e pela região da análise.

export const ROTULO_INDICADOR: Readonly<Record<Indicador, string>> = {
  pesoPessoal: 'Pessoal',
  pesoAdmCentral: 'Adm. Central',
  pesoViagens: 'Viagens',
  pesoBens: 'Bens',
  custoMedioMeta: 'Custo médio por meta',
  execucao: 'Execução',
};

export const TEXTOS_COMPARATIVO = {
  CAPTION: 'Termos de Parceria lado a lado (pesos e execução em % do Valor Global)',
  MEDIANA: 'Mediana',
  ACIMA: 'acima da curva',
  ABAIXO: 'abaixo da curva',
  NAO_OFICIAL: '(versão não oficial)',
  SEM_VALOR: 'sem valor',
  MOTIVO: {
    NAO_OFICIAL: 'só na versão oficial',
    POUCOS_POSTOS: 'omitido: menos de 3 postos',
    CUSTO_INCOMPLETO: 'omitido: custo de pessoal não calculado',
    CUSTOS_IGUAIS: 'omitido: custos iguais',
    SEM_DADOS: 'omitido',
  } satisfies Record<MotivoPesosOmitidos, string>,
  OMITIDOS: (n: number) => `${n} TP(s) além do limite ficaram fora do comparativo.`,
  LEGENDA:
    'Fora da curva: abaixo do 1º quartil menos 1,5 vez a distância entre quartis, ou acima do 3º quartil mais 1,5 vez (com pelo menos 4 TPs). ' +
    'Os pesos só aparecem para a versão oficial e, com pessoal, com pelo menos 3 postos de custos diferentes (privacidade). A execução é zero até haver o realizado.',
} as const;

const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

// Percentual em texto, sem o teto do NUMERIC(9,4) (a razão é indicador calculado e pode passar de 99.999%).
const percentual = (pontos: string) => `${pontos.replace('.', ',')}%`;

function Valor({ ind, v }: { ind: Indicador; v: string | null }) {
  if (v === null) return <span aria-label={TEXTOS_COMPARATIVO.SEM_VALOR}>—</span>;
  return <>{ind === 'custoMedioMeta' ? Dinheiro.de(v).formatar() : percentual(v)}</>;
}

function Celula({ tp, ind }: { tp: TpComparado; ind: Indicador }) {
  if (tp.pesosOmitidos && PESOS.includes(ind)) return <td>{TEXTOS_COMPARATIVO.MOTIVO[tp.pesosOmitidos]}</td>;
  const marca = tp.foraDaCurva.find((f) => f.indicador === ind);
  return (
    <td>
      <Valor ind={ind} v={tp.indicadores[ind]} />
      {marca && <strong> ({marca.direcao === 'ACIMA' ? TEXTOS_COMPARATIVO.ACIMA : TEXTOS_COMPARATIVO.ABAIXO})</strong>}
    </td>
  );
}

export function TabelaComparativo({ comparativo }: { comparativo: Comparativo }) {
  return (
    <div>
      {/* Rolagem horizontal em tela estreita, alcançável pelo teclado (WCAG 1.4.10). */}
      <div role="region" aria-label={TEXTOS_COMPARATIVO.CAPTION} tabIndex={0} style={{ overflowX: 'auto' }}>
      <table>
        <caption>{TEXTOS_COMPARATIVO.CAPTION}</caption>
        <thead>
          <tr>
            <th scope="col">TP</th>
            <th scope="col">Vigência</th>
            <th scope="col">Valor Global</th>
            {INDICADORES.map((i) => (
              <th key={i} scope="col">
                {ROTULO_INDICADOR[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparativo.tps.map((tp) => (
            <tr key={tp.numero}>
              <th scope="row">
                {tp.numero} {tp.oficial ? '' : TEXTOS_COMPARATIVO.NAO_OFICIAL}
              </th>
              <td>
                {mes(tp.vigencia.inicio)} a {mes(tp.vigencia.fim)}
              </td>
              <td>{tp.valorGlobal === null ? '—' : Dinheiro.de(tp.valorGlobal).formatar()}</td>
              {INDICADORES.map((i) => (
                <Celula key={i} tp={tp} ind={i} />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{TEXTOS_COMPARATIVO.MEDIANA}</th>
            <td colSpan={2} />
            {INDICADORES.map((i) => (
              <td key={i}>
                <Valor ind={i} v={comparativo.medianas[i]} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      </div>
      {comparativo.tpsOmitidos > 0 && <p role="note">{TEXTOS_COMPARATIVO.OMITIDOS(comparativo.tpsOmitidos)}</p>}
      <p>{TEXTOS_COMPARATIVO.LEGENDA}</p>
    </div>
  );
}
