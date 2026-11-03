import { describe, expect, it } from 'vitest';
import * as gerServidor from '@/modules/ger/servidor';

// O leitor seguro sai pelo servidor.ts (R22), para o cad e para a US-121 da frente A.
describe('ger/servidor: leitor de planilhas', () => {
  it('exporta lerPlanilhaSegura e LIMITES_PADRAO', () => {
    expect(gerServidor.lerPlanilhaSegura).toBeTypeOf('function');
    expect(gerServidor.lerPlanilhasSegura).toBeTypeOf('function');
    expect(gerServidor.MSG_LEITOR_OCUPADO).toBe('Outra planilha está sendo lida. Tente de novo em instantes.');
    expect(gerServidor.LIMITES_PADRAO).toEqual({
      bytes: 1024 * 1024,
      entradas: 50,
      descompactado: 20 * 1024 * 1024,
      razao: 100,
      linhas: 20_000,
      colunas: 30,
      caracteresCelula: 1_000,
    });
  });
});
