import { Dinheiro, Percentual } from '@/shared/kernel';

// O que mudou entre duas versões da proposta (US-084, parte determinística; IA-13 da spec §6.8; plano do P30).
// Função pura: as somas por conta, o rateio e os tetos de cada lado chegam prontos; aqui só se compara.

/** D-P30-4 [PROVISÓRIO]: as faixas dos pontos de atenção, até a GFIN definir outras. */
export const VARIACAO_ATENCAO_CONTA = '0.20';
export const VARIACAO_ATENCAO_TOTAL = '0.10';

export type LadoComparacao = { porConta: ReadonlyMap<string, Dinheiro>; total: Dinheiro; rateio: Dinheiro; tetos: Dinheiro };

export type DiferencaConta = { conta: string; antes: Dinheiro; depois: Dinheiro; diferenca: Dinheiro; percentual: Percentual | null };

export type Comparacao = {
  total: DiferencaConta;
  rateio: { antes: Dinheiro; depois: Dinheiro; diferenca: Dinheiro };
  tetos: { antes: Dinheiro; depois: Dinheiro; diferenca: Dinheiro };
  novas: readonly DiferencaConta[];
  retiradas: readonly DiferencaConta[];
  alteradas: readonly DiferencaConta[];
  atencao: readonly string[];
};

const absoluto = (d: Dinheiro) => (d.ehNegativo() ? d.negar() : d);
const passou = (diferenca: Dinheiro, base: Dinheiro, faixa: string) => absoluto(diferenca).comparar(absoluto(base).multiplicar(faixa)) > 0;
const porConta = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

function diferenca(conta: string, antes: Dinheiro, depois: Dinheiro): DiferencaConta {
  const d = depois.subtrair(antes);
  return { conta, antes, depois, diferenca: d, percentual: Percentual.razao(d, antes) };
}

/** Sinal explícito: "+ R$ 1.000,00" ou "- R$ 500,00". */
export const comSinal = (d: Dinheiro) => (d.ehNegativo() ? `- ${d.negar().formatar()}` : `+ ${d.formatar()}`);

export function compararVersoes(atual: LadoComparacao, anterior: LadoComparacao): Comparacao {
  const contas = [...new Set([...atual.porConta.keys(), ...anterior.porConta.keys()])].sort(porConta);
  const novas: DiferencaConta[] = [];
  const retiradas: DiferencaConta[] = [];
  const alteradas: DiferencaConta[] = [];
  const atencao: string[] = [];
  for (const c of contas) {
    const antes = anterior.porConta.get(c) ?? Dinheiro.zero();
    const depois = atual.porConta.get(c) ?? Dinheiro.zero();
    if (antes.igual(depois)) continue;
    const d = diferenca(c, antes, depois);
    if (antes.ehZero()) {
      novas.push(d);
      atencao.push(`Conta ${c} nova (${depois.formatar()}).`);
    } else if (depois.ehZero()) {
      retiradas.push(d);
      atencao.push(`Conta ${c} retirada (era ${antes.formatar()}).`);
    } else {
      alteradas.push(d);
      if (passou(d.diferenca, antes, VARIACAO_ATENCAO_CONTA)) atencao.push(`Conta ${c} variou ${d.percentual!.formatar()} (${comSinal(d.diferenca)}).`);
    }
  }
  const total = diferenca('total', anterior.total, atual.total);
  if (!anterior.total.ehZero() && passou(total.diferenca, anterior.total, VARIACAO_ATENCAO_TOTAL)) {
    atencao.unshift(`O Valor Global variou ${total.percentual!.formatar()} (${comSinal(total.diferenca)}).`);
  }
  return {
    total,
    rateio: { antes: anterior.rateio, depois: atual.rateio, diferenca: atual.rateio.subtrair(anterior.rateio) },
    tetos: { antes: anterior.tetos, depois: atual.tetos, diferenca: atual.tetos.subtrair(anterior.tetos) },
    novas,
    retiradas,
    alteradas,
    atencao,
  };
}
