import { Dinheiro, Percentual } from '@/shared/kernel';
import { INDICADORES, type Comparativo, type Indicador, type TpComparado } from '../domain/comparativo-tps';

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
  OMITIDO: 'omitido',
  OMITIDOS: (n: number) => `${n} TP(s) além do limite ficaram fora do comparativo.`,
  LEGENDA:
    'Fora da curva: abaixo do 1º quartil menos 1,5 vez a distância entre quartis, ou acima do 3º quartil mais 1,5 vez (com pelo menos 4 TPs). ' +
    'O pessoal de TP com 1 ou 2 postos fica omitido (privacidade). A execução é zero até haver o realizado.',
} as const;

const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

function textoValor(ind: Indicador, v: string | null): string {
  if (v === null) return '—';
  return ind === 'custoMedioMeta' ? Dinheiro.de(v).formatar() : Percentual.dePontos(v).formatar();
}

function Celula({ tp, ind }: { tp: TpComparado; ind: Indicador }) {
  if (ind === 'pesoPessoal' && tp.pessoalOmitido) return <td>{TEXTOS_COMPARATIVO.OMITIDO}</td>;
  const marca = tp.foraDaCurva.find((f) => f.indicador === ind);
  return (
    <td>
      {textoValor(ind, tp.indicadores[ind])}
      {marca && <strong> ({marca.direcao === 'ACIMA' ? TEXTOS_COMPARATIVO.ACIMA : TEXTOS_COMPARATIVO.ABAIXO})</strong>}
    </td>
  );
}

export function TabelaComparativo({ comparativo }: { comparativo: Comparativo }) {
  return (
    <div>
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
            <td />
            <td />
            {INDICADORES.map((i) => (
              <td key={i}>{textoValor(i, comparativo.medianas[i])}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      {comparativo.tpsOmitidos > 0 && <p role="note">{TEXTOS_COMPARATIVO.OMITIDOS(comparativo.tpsOmitidos)}</p>}
      <p>{TEXTOS_COMPARATIVO.LEGENDA}</p>
    </div>
  );
}
