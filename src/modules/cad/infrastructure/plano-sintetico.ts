import type { LinhaLida } from '../domain/plano-contas';
import oficial from './dados/plano-contas-oficial.json';

// Plano de contas sintético para os testes de desempenho (plano do P7, Task 3, Step 1, D-P7-3; o
// `fixme` da rolagem da Tree Grid). A carga do plano substitui tudo (o que sai do arquivo é
// inativado), então o sintético é o plano oficial inteiro mais um ramo "9" até o total pedido: nada
// do oficial é inativado. As linhas seguem o layout da planilha (COLUNAS_PLANO_CONTAS) e passam
// pelo validarPlanoContas; quem grava o .xlsx é o ops/carga/gerar-plano.ts, e a carga vai pela tela.

const REDUZIDO_INICIAL = 50_000; // os reduzidos oficiais têm até 4 dígitos
const POR_GRUPO = 10; // analíticas por conta de nível 4, e filhos por sintética

type Celulas = Record<string, string | null>;

export function gerarPlanoSintetico(total: number): LinhaLida[] {
  const celulas: Celulas[] = (oficial as { celulas: Celulas }[]).map((l) => ({ ...l.celulas }));
  if (!Number.isInteger(total) || total < celulas.length + 5) {
    throw new Error(`O plano sintético precisa de pelo menos ${celulas.length + 5} linhas (o oficial mais um ramo).`);
  }
  const conta = (nivel: number, classificacao: string, pai: string | null, reduzido: string | null) =>
    celulas.push({
      'Nível': String(nivel),
      'Classificação': classificacao,
      'Conta Superior': pai,
      'Descrição': nivel === 1 ? 'CARGA SINTÉTICA (TESTE DE DESEMPENHO)' : `Conta sintética de carga ${classificacao}`,
      'Tipo': nivel === 5 ? 'A' : 'S',
      'Conta Reduzida': reduzido,
    });

  // Contadores de 1 a POR_GRUPO por nível; a abertura de um grupo novo cria os pais que faltam.
  let [a, b, c, d] = [1, 1, 1, 0];
  conta(1, '9', null, null);
  conta(2, '9.1', '9', null);
  conta(3, '9.1.1', '9.1', null);
  conta(4, '9.1.1.1', '9.1.1', null);
  let reduzido = REDUZIDO_INICIAL;
  while (celulas.length < total) {
    // Um grupo novo só abre se couberem os pais (até 3) e uma analítica; senão, o atual cresce.
    if (d === POR_GRUPO && total - celulas.length >= 4) {
      d = 0;
      c += 1;
      if (c > POR_GRUPO) {
        c = 1;
        b += 1;
        if (b > POR_GRUPO) {
          b = 1;
          a += 1;
          conta(2, `9.${a}`, '9', null);
        }
        conta(3, `9.${a}.${b}`, `9.${a}`, null);
      }
      conta(4, `9.${a}.${b}.${c}`, `9.${a}.${b}`, null);
    }
    d += 1;
    conta(5, `9.${a}.${b}.${c}.${d}`, `9.${a}.${b}.${c}`, String(reduzido));
    reduzido += 1;
  }
  return celulas.map((c, i) => ({ numero: i + 2, celulas: c }));
}
