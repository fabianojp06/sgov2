import { Dinheiro, distribuirEm12, ErroDominio, type Percentual } from '@/shared/kernel';

// Pacote base zero (spec §6.6; R4 do plano do P6).
export type Prioridade = 'ESSENCIAL' | 'IMPORTANTE' | 'DESEJAVEL';

export type DadosPacote = {
  quantidade: number;
  valorUnitario: Dinheiro;
  corrigirIpca: boolean;
  distribuicao: 'MENSAL' | 'PONTUAL';
  mesOcorrencia: number | null;
};

// Anual = (quantidade × valor unitário) × (1 + IPCA, se corrigir), com um só Half-Even no fim: o
// produto por quantidade inteira é exato. Mensal: 12 parcelas com a diferença em dezembro.
// Pontual: o anual inteiro no mês de ocorrência. O IPCA vem das premissas do exercício (C2).
export function calcularPacote(p: DadosPacote, ipca: Percentual): { valorAnual: Dinheiro; meses: readonly Dinheiro[] } {
  if ((p.distribuicao === 'PONTUAL') !== (p.mesOcorrencia !== null)) {
    throw new ErroDominio('orc.pacote_invalido', 'Pacote pontual exige o mês, e o mensal não tem mês.');
  }
  const bruto = p.valorUnitario.multiplicar(String(p.quantidade)); // exato: quantidade inteira
  const valorAnual = p.corrigirIpca ? bruto.multiplicar(ipca.comoFracao().plus(1)) : bruto;
  if (p.distribuicao === 'MENSAL') return { valorAnual, meses: distribuirEm12(valorAnual) };
  const meses = Array.from({ length: 12 }, (_, i) => (i + 1 === p.mesOcorrencia ? valorAnual : Dinheiro.zero()));
  return { valorAnual, meses };
}
