import { describe, expect, it } from 'vitest';
import { Percentual } from '@/shared/kernel';
import { classificarSemaforo } from './semaforo';

// RN_PLA_006 / C7 (plano do P4, Task 9a, Step 1).
const faixas = { verdeAte: Percentual.dePontos('70'), amareloAte: Percentual.dePontos('85'), laranjaAte: Percentual.dePontos('95') };

describe('classificarSemaforo', () => {
  it.each([
    ['70.00', 'VERDE'],
    ['70.01', 'AMARELO'],
    ['85.00', 'AMARELO'],
    ['85.01', 'LARANJA'],
    ['95.00', 'LARANJA'],
    ['95.01', 'VERMELHO'],
    ['131.91', 'VERMELHO'],
    ['0', 'VERDE'],
  ])('%s%% → %s', (uso, faixa) => {
    expect(classificarSemaforo(Percentual.dePontos(uso), faixas)).toBe(faixa);
  });

  it('sem uso (sem teto) → null', () => {
    expect(classificarSemaforo(null, faixas)).toBeNull();
  });
});
