import { describe, expect, it } from 'vitest';
import { Dinheiro, Percentual } from '@/shared/kernel';
import type { PosicaoPessoal, PremissasExercicio } from './custo-pessoal';
import { calcularCustoPosicao, calcularEncargo } from './motor-custo-pessoal';

// MotorCustoPessoal (plano do P4, Task 11): valores conferidos à mão, na ordem de operações da R14.
const pct = (p: string) => Percentual.dePontos(p);
const R = (v: string) => Dinheiro.de(v);
const premissas = (extra: Partial<PremissasExercicio> = {}): PremissasExercicio => ({
  ano: 2027,
  versao: 3,
  congelado: false,
  provisorio: true,
  reajuste: pct('5'),
  mesDataBase: 5,
  ipca: pct('4'),
  salarioMinimo: R('1518.00'),
  encargos: [
    { componente: 'encargo.inss', nome: 'INSS', percentual: pct('38'), conta: '4.1.1.2.001' },
    { componente: 'encargo.fgts', nome: 'FGTS', percentual: pct('8'), conta: '4.1.1.2.005' },
    { componente: 'encargo.pis', nome: 'PIS/PASEP', percentual: pct('1'), conta: '4.1.1.2.008' },
    { componente: 'encargo.obrigacoes', nome: 'Obrigações', percentual: pct('3.8'), conta: '4.1.1.8.003' },
    { componente: 'encargo.riscos', nome: 'Riscos', percentual: pct('0.2'), conta: '4.1.1.8.004' },
  ],
  contas: { salario: '4.1.1.1.001', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' },
  beneficios: [
    { componente: 'beneficio.vr', nome: 'VR', forma: 'VALOR_MENSAL', valorMensal: R('800.00'), conta: '4.1.1.1.009' },
    { componente: 'beneficio.saude', nome: 'Saúde', forma: 'VALOR_MENSAL', valorMensal: R('600.00'), conta: '4.1.1.1.008' },
    { componente: 'beneficio.vida', nome: 'Vida', forma: 'VALOR_MENSAL', valorMensal: R('50.00'), conta: '4.1.1.1.007' },
  ],
  avisos: [],
  ...extra,
});
const posicao: PosicaoPessoal = { quantidade: 2, salarioMensal: R('7500.00'), mesInicio: 1, mesSaida: 12 };

function serie(p: PosicaoPessoal = posicao, pr: PremissasExercicio = premissas()) {
  const r = calcularCustoPosicao(p, pr);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.valor;
}
const mes = (s: ReturnType<typeof serie>, c: string, m: number) => s.linhas.find((l) => l.componente === c)?.meses[m - 1]?.paraString() ?? '0.00';

describe('calcularEncargo (RN_CAR_17)', () => {
  it('RN_CAR_17 encargo do exemplo do C&S V4: 6.500,00 → 3.315,00', () => {
    const e = calcularEncargo(R('6500.00'), premissas().encargos);
    expect(e.total.paraString()).toBe('3315.00');
    expect(e.componentes.map((c) => [c.componente, c.valor.paraString()])).toEqual([
      ['encargo.inss', '2470.00'],
      ['encargo.fgts', '520.00'],
      ['encargo.pis', '65.00'],
      ['encargo.obrigacoes', '247.00'],
      ['encargo.riscos', '13.00'],
    ]);
  });

  it('R13: total com um Half-Even e o resto de centavo no INSS', () => {
    const jan = calcularEncargo(R('17916.67'), premissas().encargos);
    expect(jan.total.paraString()).toBe('9137.50');
    expect(jan.componentes[0]!.valor.paraString()).toBe('6808.34');
    const mai = calcularEncargo(R('18812.50'), premissas().encargos);
    expect(mai.total.paraString()).toBe('9594.38'); // 9.594,375 → Half-Even para cima (7 é ímpar)
    expect(mai.componentes.map((c) => c.valor.paraString())).toEqual(['7148.76', '1505.00', '188.12', '714.88', '37.62']);
    for (const e of [jan, mai]) expect(Dinheiro.somarTodos(e.componentes.map((c) => c.valor)).paraString()).toBe(e.total.paraString());
  });
});

describe('calcularEncargo: o resto vai para o maior percentual', () => {
  it('INSS 0%: o resto não vai para ele (sem linha negativa)', () => {
    const encargos = premissas().encargos.map((e) => (e.componente === 'encargo.inss' ? { ...e, percentual: pct('0') } : e));
    const r = calcularEncargo(R('10000.19'), encargos);
    expect(r.componentes[0]!.valor.paraString()).toBe('0.00');
    expect(r.componentes.every((c) => !c.valor.ehNegativo())).toBe(true);
    expect(Dinheiro.somarTodos(r.componentes.map((c) => c.valor)).paraString()).toBe(r.total.paraString());
  });

  it('sem INSS: o resto vai para o de maior percentual', () => {
    const encargos = premissas().encargos.filter((e) => e.componente !== 'encargo.inss');
    const r = calcularEncargo(R('17916.67'), encargos);
    expect(Dinheiro.somarTodos(r.componentes.map((c) => c.valor)).paraString()).toBe(r.total.paraString());
    expect(r.componentes[0]!.componente).toBe('encargo.fgts');
  });
});

describe('calcularCustoPosicao (REQ_CAR_013, R14)', () => {
  it('férias com um arredondamento só: 1 × 1.000,02 → férias 111,11 (não 13º + 13º/3 = 111,12) e 13º 83,34', () => {
    const s = serie({ quantidade: 1, salarioMensal: R('1000.02'), mesInicio: 1, mesSaida: 1 }, premissas({ beneficios: [] }));
    expect([mes(s, 'ferias', 1), mes(s, 'decimo_terceiro', 1)]).toEqual(['111.11', '83.34']);
  });

  it('R14a: benefício percentual sobre o salário, não sobre salário + periculosidade', () => {
    const s = serie(
      { ...posicao, adicional: { tipo: 'PERICULOSIDADE' } },
      premissas({ beneficios: [{ componente: 'beneficio.prev', nome: 'Previdência', forma: 'PERCENTUAL_SALARIO', percentual: pct('2'), conta: '4.1.1.1.006' }] }),
    );
    expect(mes(s, 'beneficio.prev', 1)).toBe('300.00');
  });

  it('componente zerado não gera linha (encargo de 0%)', () => {
    const encargos = premissas().encargos.map((e) => (e.componente === 'encargo.riscos' ? { ...e, percentual: pct('0') } : e));
    expect(serie(posicao, premissas({ encargos })).linhas.map((l) => l.componente)).not.toContain('encargo.riscos');
  });

  it.each([
    ['benefício', premissas({ beneficios: [{ componente: 'beneficio.vr', nome: 'VR', forma: 'VALOR_MENSAL', valorMensal: R('800.00'), conta: '' }] }), posicao, 'premissas.beneficio.vr'],
    ['encargo', premissas({ encargos: premissas().encargos.map((e) => (e.componente === 'encargo.fgts' ? { ...e, conta: '' } : e)) }), posicao, 'premissas.encargo.fgts'],
    ['adicional com adicional na posição', premissas({ contas: { ...premissas().contas, adicional: '' } }), { ...posicao, adicional: { tipo: 'PERICULOSIDADE' } as const }, 'premissas.contas.adicional'],
  ])('conta vazia de %s → erro no campo', (_caso, pr, p, campo) => {
    expect(calcularCustoPosicao(p, pr)).toEqual({ ok: false, erros: [expect.objectContaining({ campo })] });
  });

  it('conta do adicional vazia sem adicional na posição: calcula normalmente', () => {
    expect(calcularCustoPosicao(posicao, premissas({ contas: { ...premissas().contas, adicional: '' } })).ok).toBe(true);
  });

  it('premissas sem encargos → erro (não um encargo zero silencioso)', () => {
    expect(calcularCustoPosicao(posicao, premissas({ encargos: [] }))).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'premissas.encargos' })] });
  });

  it('posição do exemplo da planilha-modelo: jan–abr e mai–dez conferidos, total anual 370.271,72', () => {
    const s = serie();
    const esperado = {
      1: { salario: '15000.00', ferias: '1666.67', decimo_terceiro: '1250.00', 'encargo.inss': '6808.34', 'encargo.fgts': '1433.33', 'encargo.pis': '179.17', 'encargo.obrigacoes': '680.83', 'encargo.riscos': '35.83' },
      5: { salario: '15750.00', ferias: '1750.00', decimo_terceiro: '1312.50', 'encargo.inss': '7148.76', 'encargo.fgts': '1505.00', 'encargo.pis': '188.12', 'encargo.obrigacoes': '714.88', 'encargo.riscos': '37.62' },
    } as const;
    for (const [m, comps] of Object.entries(esperado)) {
      for (const [c, v] of Object.entries(comps)) expect(mes(s, c, Number(m)), `${c} mês ${m}`).toBe(v);
    }
    expect(['beneficio.vr', 'beneficio.saude', 'beneficio.vida'].map((c) => mes(s, c, 1))).toEqual(['1600.00', '1200.00', '100.00']);
    expect(s.totalMes[0]!.paraString()).toBe('29954.17');
    expect(s.totalMes[3]!.paraString()).toBe('29954.17');
    expect(s.totalMes[4]!.paraString()).toBe('31306.88');
    expect(s.totalMes[11]!.paraString()).toBe('31306.88');
    expect(s.total.paraString()).toBe('370271.72');
    expect(s.linhas.find((l) => l.componente === 'salario')!.total.paraString()).toBe('186000.00');
    expect(s).toMatchObject({ ano: 2027, versaoPremissas: 3 });
  });

  it('sem drift: a soma das linhas é o totalMes, e a soma dos meses é o total', () => {
    const s = serie();
    for (let i = 0; i < 12; i++) expect(Dinheiro.somarTodos(s.linhas.map((l) => l.meses[i]!)).paraString()).toBe(s.totalMes[i]!.paraString());
    expect(Dinheiro.somarTodos(s.totalMes).paraString()).toBe(s.total.paraString());
    for (const l of s.linhas) expect(l.meses).toHaveLength(12);
  });

  it('início 3 e saída 10 → meses 1, 2, 11 e 12 zerados', () => {
    const s = serie({ ...posicao, mesInicio: 3, mesSaida: 10 });
    expect([1, 2, 11, 12].map((m) => s.totalMes[m - 1]!.ehZero())).toEqual([true, true, true, true]);
    expect(s.totalMes[2]!.ehZero()).toBe(false);
  });

  it('RN_CAR_11 insalubridade de grau médio com SMN de 1.518,00 e 1 pessoa → 303,60, sem reajuste', () => {
    const s = serie({ quantidade: 1, salarioMensal: R('3000.00'), mesInicio: 1, mesSaida: 12, adicional: { tipo: 'INSALUBRIDADE', grau: 'MEDIO' } });
    expect([mes(s, 'adicional', 1), mes(s, 'adicional', 12)]).toEqual(['303.60', '303.60']);
    expect(s.linhas.find((l) => l.componente === 'adicional')!.conta).toBe('4.1.1.1.025');
  });

  it('RN_CAR_10 periculosidade em 5.000,00 → 1.500,00, e 1.575,00 depois da data-base', () => {
    const s = serie({ quantidade: 1, salarioMensal: R('5000.00'), mesInicio: 1, mesSaida: 12, adicional: { tipo: 'PERICULOSIDADE' } });
    expect([mes(s, 'adicional', 4), mes(s, 'adicional', 5)]).toEqual(['1500.00', '1575.00']);
  });

  it('R14a benefício PERCENTUAL_SALARIO de 2%, 2 × 7.500,00 → 300,00 até abril e 315,00 depois', () => {
    const s = serie(posicao, premissas({ beneficios: [{ componente: 'beneficio.prev', nome: 'Previdência', forma: 'PERCENTUAL_SALARIO', percentual: pct('2'), conta: '4.1.1.1.006' }] }));
    expect([mes(s, 'beneficio.prev', 4), mes(s, 'beneficio.prev', 5)]).toEqual(['300.00', '315.00']);
  });

  it.each([
    ['quantidade 0', { ...posicao, quantidade: 0 }, 'quantidade'],
    ['quantidade 1,5', { ...posicao, quantidade: 1.5 }, 'quantidade'],
    ['salário 0', { ...posicao, salarioMensal: Dinheiro.zero() }, 'salarioMensal'],
    ['saída antes do início', { ...posicao, mesInicio: 5, mesSaida: 4 }, 'mesSaida'],
    ['mês 13', { ...posicao, mesSaida: 13 }, 'mesSaida'],
  ])('%s → erro no campo, sem exceção', (_caso, p, campo) => {
    expect(calcularCustoPosicao(p, premissas())).toEqual({ ok: false, erros: [expect.objectContaining({ campo })] });
  });

  it('insalubridade sem SMN → a mensagem do plano', () => {
    const r = calcularCustoPosicao({ ...posicao, adicional: { tipo: 'INSALUBRIDADE', grau: 'MINIMO' } }, premissas({ salarioMinimo: null }));
    expect(r).toEqual({
      ok: false,
      erros: [{ campo: 'adicional', mensagem: 'Cadastre o Salário Mínimo Nacional do exercício antes de usar insalubridade.' }],
    });
  });

  it('componente sem conta (conta inativada pela recarga) → erro, sem cálculo', () => {
    const r = calcularCustoPosicao(posicao, premissas({ contas: { salario: '', adicional: '4.1.1.1.025', ferias: '4.1.1.1.003', decimo_terceiro: '4.1.1.1.005' } }));
    expect(r).toEqual({ ok: false, erros: [expect.objectContaining({ campo: 'premissas.contas.salario' })] });
  });
});
