import type { Percentual } from '@/shared/kernel';

// Semáforo do uso do teto (RN_PLA_006, C7): fronteiras sem sobreposição. As faixas são parâmetros
// do exercício (padrão provisório 70/85/95).
export type FaixaSemaforo = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO';
export type FaixasSemaforo = { verdeAte: Percentual; amareloAte: Percentual; laranjaAte: Percentual };

/** ≤ verde → VERDE; ≤ amarelo → AMARELO; ≤ laranja → LARANJA; acima → VERMELHO; sem uso (sem teto) → null. */
export function classificarSemaforo(uso: Percentual | null, faixas: FaixasSemaforo): FaixaSemaforo | null {
  if (uso === null) return null;
  const u = uso.comoFracao();
  if (u.lte(faixas.verdeAte.comoFracao())) return 'VERDE';
  if (u.lte(faixas.amareloAte.comoFracao())) return 'AMARELO';
  if (u.lte(faixas.laranjaAte.comoFracao())) return 'LARANJA';
  return 'VERMELHO';
}
