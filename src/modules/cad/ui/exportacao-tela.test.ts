import { describe, expect, it } from 'vitest';
import { hrefExportacao } from './arvore-contas-logica';

// Link da exportação das consultas em árvore (US-024): o que a tela mostra vai na URL.
describe('hrefExportacao', () => {
  it('formato, inativos só quando marcado e os filtros com valor (escapados)', () => {
    expect(hrefExportacao('/cad/plano-contas/exportar', 'csv', false, {})).toBe('/cad/plano-contas/exportar?formato=csv');
    expect(hrefExportacao('/cad/plano-contas/exportar', 'xlsx', true, { busca: 'pessoal & encargos', tipo: 'Analítica', vazio: '  ', marca: true })).toBe(
      '/cad/plano-contas/exportar?formato=xlsx&inativos=1&busca=pessoal+%26+encargos&tipo=Anal%C3%ADtica',
    );
  });
});
