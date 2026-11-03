import { describe, expect, it } from 'vitest';
import { estruturaFinanceiraFalsa, premissasExemplo } from '@/modules/cad/servidor';
import { contasVetadasEmPacote } from './contas-vetadas';

describe('contasVetadasEmPacote', () => {
  it('raízes de pessoal mais as contas das premissas: fixas, encargos e benefícios', async () => {
    const indice = await estruturaFinanceiraFalsa().carregarIndiceEstrutura({} as never);
    const vetadas = contasVetadasEmPacote(indice, premissasExemplo(2027));
    for (const conta of ['4.1.1.1.001', '4.1.1.2.001', '4.1.1.8.003', '4.1.1.8.004', '4.1.1.1.009']) expect(vetadas.has(conta), conta).toBe(true);
    expect(vetadas.has('4.1.1.5.005')).toBe(false); // despesa administrativa continua livre
  });

  it('sem premissas: só as raízes de pessoal', async () => {
    const indice = await estruturaFinanceiraFalsa().carregarIndiceEstrutura({} as never);
    const vetadas = contasVetadasEmPacote(indice, null);
    expect(vetadas.has('4.1.1.1.001')).toBe(true);
    expect(vetadas.has('4.1.1.8.003')).toBe(false);
  });
});
