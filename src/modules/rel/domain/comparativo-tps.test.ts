import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { compararTps, MAXIMO_TPS, mensagemComparativo, type TpEntrada } from './comparativo-tps';

// Comparativo entre TPs (US-106): indicadores, mediana, Tukey e a privacidade do pessoal.
const d = (v: string) => Dinheiro.de(v);
const tp = (numero: string, global: string | null, pessoal: string, extra: Partial<TpEntrada> = {}): TpEntrada => ({
  numero,
  tipo: 'TERMO_PARCERIA',
  situacao: 'OFICIALIZADO',
  oficial: true,
  vigencia: { inicio: '2027-01', fim: '2027-12' },
  valorGlobal: global === null ? null : d(global),
  porCategoria: { pessoal: d(pessoal), viagens: d('0'), bens: d('0'), rateioAdmCentral: d('100.00'), outros: d('0') },
  metas: [],
  realizado: d('0'),
  ...extra,
});

describe('compararTps', () => {
  it('pesos em pontos sobre o Valor Global, custo médio por meta e execução; sem Valor Global, sem peso', () => {
    const c = compararTps([
      tp('TP-1', '1000.00', '600.00', { metas: [{ numero: 'M1', valor: d('300.00') }, { numero: 'M2', valor: d('500.00') }], realizado: d('250.00') }),
      tp('TP-2', null, '10.00'),
    ]);
    expect(c.tps[0]!.indicadores).toEqual({ pesoPessoal: '60.00', pesoAdmCentral: '10.00', pesoViagens: '0.00', pesoBens: '0.00', custoMedioMeta: '400.00', execucao: '25.00' });
    expect(c.tps[0]!.metas).toBe(2);
    expect(c.tps[1]!.indicadores).toMatchObject({ pesoPessoal: null, execucao: null, custoMedioMeta: null });
    expect(c.medianas.pesoPessoal).toBe('60.00');
  });

  it('Tukey: com 4 ou mais TPs, marca o que foge (acima e abaixo); com menos, nada é marcado', () => {
    const base = ['50.00', '52.00', '55.00', '53.00', '51.00'].map((p, i) => tp(`TP-${i}`, '100.00', p));
    const c = compararTps([...base, tp('TP-ALTO', '100.00', '95.00'), tp('TP-BAIXO', '100.00', '5.00')]);
    const marcas = Object.fromEntries(c.tps.map((t) => [t.numero, t.foraDaCurva.filter((f) => f.indicador === 'pesoPessoal').map((f) => f.direcao)]));
    expect(marcas['TP-ALTO']).toEqual(['ACIMA']);
    expect(marcas['TP-BAIXO']).toEqual(['ABAIXO']);
    expect(marcas['TP-0']).toEqual([]);
    expect(c.medianas.pesoPessoal).toBe('52.00');
    const poucos = compararTps([tp('A', '100.00', '1.00'), tp('B', '100.00', '2.00'), tp('C', '100.00', '99.00')]);
    expect(poucos.tps.every((t) => t.foraDaCurva.length === 0)).toBe(true);
  });

  it('pessoal de TP com 1 ou 2 postos fica omitido (privacidade, como na US-107)', () => {
    const c = compararTps([tp('TP-1', '1000.00', '600.00', { postos: 2 }), tp('TP-2', '1000.00', '600.00', { postos: 3 }), tp('TP-3', '1000.00', '0.00', { postos: 0 })]);
    expect(c.tps.map((t) => [t.pessoalOmitido, t.indicadores.pesoPessoal])).toEqual([
      [true, null],
      [false, '60.00'],
      [false, '0.00'],
    ]);
    expect(mensagemComparativo(c)).not.toContain('600');
  });

  it('no máximo MAXIMO_TPS, com a contagem dos omitidos', () => {
    const c = compararTps(Array.from({ length: MAXIMO_TPS + 3 }, (_, i) => tp(`TP-${i}`, '100.00', '1.00')));
    expect(c.tps).toHaveLength(MAXIMO_TPS);
    expect(c.tpsOmitidos).toBe(3);
  });
});
