import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerPlanilhaSegura } from '@/modules/ger/servidor';
import { encontrarMarcaVedada } from '@/shared/config';
import { sanearDescricao } from '../application/saneamento';
import { COLUNAS_CENTROS_CUSTO, validarCentrosCusto } from '../domain/centros-custo';
import type { LinhaLida } from '../domain/plano-contas';
import minuta from './dados/cc-minuta-rev23102026.json';

// A minuta de CC transcrita (plano do P4, Task 5, Step 1). Fica fora de domain/, que não importa infrastructure/.
describe('minuta de centros de custo (Rev23102026)', () => {
  it('35 CCs, 8 sintéticos, 27 analíticos, 7 de gestão e nenhum aviso da R3', () => {
    const r = validarCentrosCusto(minuta as LinhaLida[], sanearDescricao);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.centros).toHaveLength(35);
    expect(r.centros.filter((c) => c.tipo === 'SINTETICO')).toHaveLength(8);
    expect(r.centros.filter((c) => c.tipo === 'ANALITICO')).toHaveLength(27);
    expect(r.centros.filter((c) => c.deGestao).map((c) => c.classificacao)).toHaveLength(7);
    expect(r.avisos).toEqual([]);
    expect(encontrarMarcaVedada(JSON.stringify(minuta))).toEqual([]);
  });

  it('a planilha de especificacao/ bate com o JSON (cabeçalho achado nas 10 primeiras linhas, reduzido como texto)', async () => {
    const nome = 'Plano de Centros de Custo - Minuta Rev23102026 - CCs de gestao.xlsx';
    const r = await lerPlanilhaSegura(
      { nome, conteudo: new Uint8Array(readFileSync(join(process.cwd(), 'especificacao', nome))) },
      { colunas: COLUNAS_CENTROS_CUSTO, linhaCabecalhoMax: 10, colunasTexto: ['Código reduzido'] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.errosCelula).toEqual([]);
    expect(r.valor.linhas).toEqual(minuta);
  });
});
