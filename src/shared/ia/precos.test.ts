import { describe, expect, it } from 'vitest';
import { inicioDoMes } from './governanca';
import { custoEmUnidades, unidadesParaUsd, usdParaUnidades } from './precos';

describe('custo estimado (US-019)', () => {
  it('claude-opus-5-5: US$ 4 e 20 por milhão, cache a 0,20 (leitura) e 5 (escrita)', () => {
    const milhao = { entrada: 1_000_000, saida: 1_000_000, cacheLeitura: 1_000_000, cacheEscrita: 1_000_000 };
    expect(unidadesParaUsd(custoEmUnidades('claude-opus-5-5', milhao))).toBe('29.20000000');
  });

  it('um token só: exato em 8 casas, sem number', () => {
    expect(unidadesParaUsd(custoEmUnidades('claude-opus-5-5', { entrada: 1, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }))).toBe('0.00000400');
    expect(unidadesParaUsd(custoEmUnidades('claude-opus-5-5', { entrada: 0, saida: 0, cacheLeitura: 1, cacheEscrita: 0 }))).toBe('0.00000020');
  });

  it('modelo fora da tabela paga o preço do mais caro', () => {
    const uso = { entrada: 1000, saida: 1000, cacheLeitura: 0, cacheEscrita: 0 };
    expect(custoEmUnidades('modelo-novo', uso)).toBe(custoEmUnidades('claude-fable-5-1', uso));
    expect(custoEmUnidades('modelo-novo', uso)).toBeGreaterThan(custoEmUnidades('claude-opus-5-5', uso));
  });

  it('ida e volta do texto do banco', () => {
    expect(usdParaUnidades('12.5')).toBe(1_250_000_000n);
    expect(usdParaUnidades('0.00000001')).toBe(1n);
    expect(usdParaUnidades('7')).toBe(700_000_000n);
    expect(unidadesParaUsd(usdParaUnidades('123.45678901'))).toBe('123.45678901');
    expect(() => usdParaUnidades('1e-7')).toThrow();
    expect(() => usdParaUnidades('0.000000001')).toThrow();
  });
});

describe('inicioDoMes (America/Sao_Paulo, UTC-3)', () => {
  it('meia-noite do dia 1 em Brasília', () => {
    expect(inicioDoMes(new Date('2026-11-11T15:00:00Z')).toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('a virada é às 3h UTC: 2h59 UTC do dia 1 ainda é o mês anterior', () => {
    expect(inicioDoMes(new Date('2026-12-01T02:59:00Z')).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(inicioDoMes(new Date('2026-12-01T03:00:00Z')).toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(inicioDoMes(new Date('2027-01-01T01:00:00Z')).toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });
});
