import { describe, expect, it } from 'vitest';
import { validarPlanoContas } from '../domain/plano-contas';
import oficial from './dados/plano-contas-oficial.json';
import { gerarPlanoSintetico } from './plano-sintetico';

// Plano sintético da D-P7-3: o oficial inteiro mais o ramo "9", válido pelas mesmas regras da carga.
const semSaneamento = (texto: string) => ({ texto, retirou: false });
const oficiais = (oficial as { celulas: Record<string, string | null> }[]).length;

describe('gerarPlanoSintetico', () => {
  it.each([5000, oficiais + 5, oficiais + 6, 1234])('%i linhas exatas, válidas pelo validarPlanoContas', (total) => {
    const linhas = gerarPlanoSintetico(total);
    expect(linhas).toHaveLength(total);
    const v = validarPlanoContas(linhas, semSaneamento);
    if (!v.ok) throw new Error(JSON.stringify(v.erros.slice(0, 5)));
    expect(v.contas.filter((c) => c.nivel === 5)).toHaveLength(linhas.filter((l) => l.celulas['Tipo'] === 'A').length);
  });

  it('mantém o plano oficial inteiro e na frente, e o ramo novo só sob o "9"', () => {
    const linhas = gerarPlanoSintetico(5000);
    const original = (oficial as { celulas: Record<string, string | null> }[]).map((l) => l.celulas);
    expect(linhas.slice(0, oficiais).map((l) => l.celulas)).toEqual(original);
    expect(linhas.slice(oficiais).every((l) => l.celulas['Classificação']!.split('.')[0] === '9')).toBe(true);
    expect(linhas.map((l) => l.numero)).toEqual(Array.from({ length: 5000 }, (_, i) => i + 2));
  });

  it('recusa um total que não cabe o oficial mais um ramo', () => {
    expect(() => gerarPlanoSintetico(oficiais + 4)).toThrow(/pelo menos/);
    expect(() => gerarPlanoSintetico(5000.5)).toThrow();
  });
});
