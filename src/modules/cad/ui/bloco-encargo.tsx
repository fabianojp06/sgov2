import { Dinheiro } from '@/shared/kernel';
import type { CustoCargoTela } from '../domain/cargo-tela';

// Custo do cargo (US-051 parte 2; REQ_CAR_013): o encargo social consolidado (R$ e %) e o detalhe por
// componente, ao mesmo tempo, e o custo mensal e anual de 1 pessoa. Sem cad.salarios, só o aviso (R24).
const reais = (v: string) => Dinheiro.de(v).formatar();
const ROTULO_COMPONENTE: Readonly<Record<string, string>> = {
  salario: 'Salário',
  adicional: 'Adicional',
  ferias: 'Férias + 1/3',
  decimo_terceiro: '13º salário',
};

export function BlocoEncargo({ custo, ano }: { custo: CustoCargoTela; ano: number }) {
  if (custo.mascarado) return <p>O custo do cargo fica mascarado: você não tem a permissão de ver salários.</p>;
  if (custo.erro !== undefined) return <p role="status">{custo.erro}</p>;
  return (
    <section aria-labelledby="titulo-custo">
      <h2 id="titulo-custo">Custo de 1 pessoa em {ano}</h2>
      <p>
        Encargo social: <strong>{reais(custo.encargoTotal)}</strong> ({custo.percentualTotal}) sobre a base de {reais(custo.base)} (Fonte Ativa + adicional).
      </p>
      <table>
        <caption>Encargo social por componente</caption>
        <thead>
          <tr>
            <th scope="col">Componente</th>
            <th scope="col">Percentual</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {custo.componentes.map((c) => (
            <tr key={c.nome}>
              <th scope="row">{c.nome}</th>
              <td>{c.percentual}</td>
              <td>{reais(c.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>Custo de janeiro por componente</caption>
        <tbody>
          {custo.linhasMes1.map((l) => (
            <tr key={l.componente}>
              <th scope="row">{ROTULO_COMPONENTE[l.componente] ?? l.componente.replace(/^encargo\./, 'Encargo: ').replace(/^beneficio\./, 'Benefício: ')}</th>
              <td>{reais(l.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Custo em janeiro: {reais(custo.totalMes1)}. Custo no ano: {reais(custo.totalAno)}.
      </p>
    </section>
  );
}
