import type { TxCliente } from '@/shared/db';

// Leitura dos agrupadores para os relatórios (US-047; RF_PLA_REQ_006, RN_PLA_009): cada agrupador com as
// contas que reúne. O relatório soma os valores dessas contas, sem arredondar, numa linha de subtotal.
// Recebe o tx, sem guarda: a permissão é de quem chama.

export type AgrupadorRelatorio = Readonly<{
  id: string;
  nome: string;
  /** As contas analíticas, em ordem de classificação (inclusive as que uma recarga inativou). */
  contas: readonly Readonly<{ id: string; classificacao: string; ativa: boolean }>[];
}>;

/** Todos os agrupadores, em ordem de nome. */
export async function agrupadoresDeContas(tx: TxCliente): Promise<readonly AgrupadorRelatorio[]> {
  const lidos = await tx.agrupadorConta.findMany({
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true, itens: { select: { conta: { select: { id: true, classificacao: true, ativa: true } } } } },
  });
  return lidos.map((a) => ({
    id: a.id,
    nome: a.nome,
    contas: a.itens.map((i) => i.conta).sort((x, y) => (x.classificacao < y.classificacao ? -1 : 1)),
  }));
}
