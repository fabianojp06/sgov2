import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { ContextoAuditoria } from '@/shared/audit';
import type { TxCliente } from '@/shared/db';
import { Dinheiro, Percentual } from '@/shared/kernel';
import * as cad from '@/modules/cad';
import * as cadServidor from '@/modules/cad/servidor';
import {
  calcularCustoPosicao,
  COMPONENTES_FIXOS,
  congelarPremissasExercicio,
  custoPessoalFalso,
  garantirPremissasExercicio,
  obterPremissasExercicio,
  premissasExemplo,
  type BeneficioPremissa,
  type PosicaoPessoal,
} from '@/modules/cad';

// Contrato C2 (plano do P4, Task 3): custo de pessoal do cad.
const tx = {} as TxCliente;
const contexto = {} as ContextoAuditoria;
const posicao: PosicaoPessoal = { quantidade: 2, salarioMensal: Dinheiro.de('7500.00'), mesInicio: 3, mesSaida: 10 };

describe('C2 — falso', () => {
  it('registra as chamadas e põe valor só nos meses 3 a 10', () => {
    const falso = custoPessoalFalso();
    const p = premissasExemplo(2027);
    const r = falso.calcularCustoPosicao(posicao, p);
    expect(falso.chamadas).toEqual([{ posicao, premissas: p }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.ano).toBe(2027);
    expect(r.valor.versaoPremissas).toBe(1);
    expect(r.valor.totalMes).toHaveLength(12);
    const ativos = r.valor.totalMes.map((v, i) => (v.ehZero() ? null : i + 1)).filter((m) => m !== null);
    expect(ativos).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.valor.linhas.map((l) => [l.componente, l.conta])).toEqual([['salario', '4.1.1.1.001']]);
    expect(r.valor.linhas[0]!.meses).toHaveLength(12);
    expect(r.valor.total.paraString()).toBe('120000.00');
  });

  it.each([
    ['quantidade', { ...posicao, quantidade: 0 }],
    ['quantidade', { ...posicao, quantidade: 1.5 }],
    ['quantidade', { ...posicao, quantidade: 1e7 }],
    ['salarioMensal', { ...posicao, salarioMensal: Dinheiro.zero() }],
    ['salarioMensal', { ...posicao, salarioMensal: Dinheiro.de('-1.00') }],
    ['salarioMensal', { ...posicao, salarioMensal: Dinheiro.de('1000000.00') }],
    ['mesInicio', { ...posicao, mesInicio: 13 }],
    ['mesInicio', { ...posicao, mesInicio: 0 }],
    ['mesInicio', { ...posicao, mesInicio: 2.5 }],
    ['mesSaida', { ...posicao, mesSaida: 2 }],
    ['mesSaida', { ...posicao, mesSaida: 13 }],
  ])('posição inválida → erro no campo %s, sem exceção e sem o valor', (campo, p) => {
    const r = custoPessoalFalso().calcularCustoPosicao(p, premissasExemplo());
    expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo })] });
    expect(JSON.stringify(r)).not.toMatch(/7500|7\.500/);
  });

  it.each([
    ['periculosidade', { tipo: 'PERICULOSIDADE' } as const],
    ['insalubridade com salário mínimo', { tipo: 'INSALUBRIDADE', grau: 'MAXIMO' } as const],
  ])('%s é válida', (_caso, adicional) => {
    expect(custoPessoalFalso().calcularCustoPosicao({ ...posicao, adicional }, premissasExemplo()).ok).toBe(true);
  });

  it('insalubridade sem salário mínimo → erro no adicional', () => {
    const r = custoPessoalFalso().calcularCustoPosicao(
      { ...posicao, adicional: { tipo: 'INSALUBRIDADE', grau: 'MEDIO' } },
      { ...premissasExemplo(), salarioMinimo: null },
    );
    expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'adicional' })] });
  });

  it('obter, garantir (idempotente) e congelar', async () => {
    const falso = custoPessoalFalso();
    expect(await falso.obterPremissasExercicio(tx, 2028)).toBeNull();
    const criadas = await falso.garantirPremissasExercicio(tx, contexto, 2028);
    expect(criadas.ano).toBe(2028);
    expect(await falso.garantirPremissasExercicio(tx, contexto, 2028)).toBe(criadas);
    await falso.congelarPremissasExercicio(tx, contexto, 2027);
    expect([...falso.congelados]).toEqual([2027]);
    const congeladas = await falso.obterPremissasExercicio(tx, 2027);
    expect(congeladas).toMatchObject({ congelado: true, versao: 1 });
    await expect(falso.congelarPremissasExercicio(tx, contexto, 2030)).rejects.toMatchObject({ codigo: 'cad.premissas_inexistentes' });
    expect(falso.congelados.has(2030)).toBe(false);
  });
});

describe('C2 — premissasExemplo', () => {
  it('encargos somam 51 pontos e cobrem os 5 componentes de encargo', () => {
    const p = premissasExemplo(2027);
    const soma = p.encargos.reduce((t, e) => t.plus(e.percentual.paraString()), new Decimal(0));
    expect(soma.toString()).toBe('51');
    expect(p.encargos.map((e) => e.componente)).toEqual(COMPONENTES_FIXOS.filter((c) => c.startsWith('encargo.')));
  });

  it('contas da R14 e benefícios do exemplo da planilha-modelo', () => {
    const p = premissasExemplo();
    expect(p.contas).toEqual({ salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' });
    expect(p.beneficios.map((b) => [b.conta, b.forma === 'VALOR_MENSAL' ? b.valorMensal.paraString() : null])).toEqual([
      ['4.1.1.1.009', '800.00'],
      ['4.1.1.1.008', '600.00'],
      ['4.1.1.1.007', '50.00'],
    ]);
  });
});

describe('C2 — reais antes da Task 11', () => {
  it('calcularCustoPosicao → cad.custo_pessoal_indisponivel', () => {
    expect(() => calcularCustoPosicao(posicao, premissasExemplo())).toThrow(
      expect.objectContaining({ codigo: 'cad.custo_pessoal_indisponivel' }),
    );
  });

  it.each([
    ['obterPremissasExercicio', () => obterPremissasExercicio(tx, 2027)],
    ['garantirPremissasExercicio', () => garantirPremissasExercicio(tx, contexto, 2027)],
    ['congelarPremissasExercicio', () => congelarPremissasExercicio(tx, contexto, 2027)],
  ])('%s → cad.custo_pessoal_indisponivel', async (_nome, chamar) => {
    await expect(chamar()).rejects.toMatchObject({ name: 'ErroDominio', codigo: 'cad.custo_pessoal_indisponivel' });
  });
});

describe('C2 — tipos e exportações', () => {
  it('componente fora do catálogo e salário em number não compilam', () => {
    const b: BeneficioPremissa = {
      // @ts-expect-error benefício precisa do prefixo 'beneficio.'
      componente: 'bonus',
      nome: 'Bônus',
      forma: 'PERCENTUAL_SALARIO',
      percentual: Percentual.dePontos('1'),
      conta: '4.1.1.1.001',
    };
    const p: PosicaoPessoal = {
      quantidade: 1,
      // @ts-expect-error dinheiro nunca é number (spec §5)
      salarioMensal: 7500,
      mesInicio: 1,
      mesSaida: 12,
    };
    expect([b, p]).toHaveLength(2);
  });

  it('index.ts e servidor.ts exportam o C2 inteiro, inclusive os falsos', () => {
    const nomes = [
      'calcularCustoPosicao',
      'obterPremissasExercicio',
      'garantirPremissasExercicio',
      'congelarPremissasExercicio',
      'COMPONENTES_FIXOS',
      'premissasExemplo',
      'custoPessoalFalso',
    ];
    for (const nome of nomes) {
      expect(cad).toHaveProperty(nome);
      expect(cadServidor).toHaveProperty(nome);
    }
  });
});
