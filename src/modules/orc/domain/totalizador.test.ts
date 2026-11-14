import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { montarArvore, semaforo, separarPorPlano, type NoPlano } from './totalizador';

const d = (v: string) => Dinheiro.de(v);
const conta = (classificacao: string, filhos: NoPlano[] = []): NoPlano => {
  const nivel = classificacao.split('.').length;
  return { classificacao, descricao: `Conta ${classificacao}`, nivel, tipo: nivel === 5 ? 'ANALITICA' : 'SINTETICA', filhos };
};

describe('semaforo (RN_TOT_04, D-P23-2)', () => {
  it('as faixas 70, 85 e 95% (inclusivas) e acima', () => {
    expect(semaforo(d('100.00'), d('70.00'))).toBe('VERDE');
    expect(semaforo(d('100.00'), d('70.01'))).toBe('AMARELO');
    expect(semaforo(d('100.00'), d('85.00'))).toBe('AMARELO');
    expect(semaforo(d('100.00'), d('85.01'))).toBe('LARANJA');
    expect(semaforo(d('100.00'), d('95.00'))).toBe('LARANJA');
    expect(semaforo(d('100.00'), d('95.01'))).toBe('VERMELHO');
    expect(semaforo(d('100.00'), d('150.00'))).toBe('VERMELHO');
  });

  it('orçado zero: verde sem realizado, vermelho com realizado; sem realizado é verde (E1)', () => {
    expect(semaforo(d('0.00'), d('0.00'))).toBe('VERDE');
    expect(semaforo(d('0.00'), d('0.01'))).toBe('VERMELHO');
    expect(semaforo(d('5000.00'), d('0.00'))).toBe('VERDE');
  });
});

describe('montarArvore e separarPorPlano (REQ_TOT_001, D-P23-3)', () => {
  const plano = [
    conta('4', [
      conta('4.1', [conta('4.1.1', [conta('4.1.1.1', [conta('4.1.1.1.001'), conta('4.1.1.1.002')])])]),
      conta('4.2', [conta('4.2.1', [conta('4.2.1.1', [conta('4.2.1.1.001')])])]),
    ]),
  ];
  const valores = new Map([
    ['4', d('300.00')],
    ['4.1', d('300.00')],
    ['4.1.1', d('300.00')],
    ['4.1.1.1', d('300.00')],
    ['4.1.1.1.001', d('100.00')],
    ['4.1.1.1.002', d('200.00')],
  ]);

  it('só os ramos com valor, com saldo = orçado e semáforo verde', () => {
    const a = montarArvore(plano, (c) => valores.get(c) ?? Dinheiro.zero());
    expect(a).toHaveLength(1);
    const raiz = a[0]!;
    expect(raiz.filhos.map((f) => f.classificacao)).toEqual(['4.1']);
    const folhas = raiz.filhos[0]!.filhos[0]!.filhos[0]!.filhos;
    expect(folhas.map((f) => [f.classificacao, f.orcado.paraString(), f.saldo.paraString(), f.semaforo, f.analitica])).toEqual([
      ['4.1.1.1.001', '100.00', '100.00', 'VERDE', true],
      ['4.1.1.1.002', '200.00', '200.00', 'VERDE', true],
    ]);
  });

  it('com o realizado (D-P33-5): o ramo só com realizado aparece; saldo e semáforo usam o realizado', () => {
    const real = new Map([['4.2.1.1.001', d('50.00')], ['4.2.1.1', d('50.00')], ['4.2.1', d('50.00')], ['4.2', d('50.00')], ['4', d('50.00')], ['4.1.1.1.002', d('190.00')]]);
    const a = montarArvore(plano, (c) => valores.get(c) ?? Dinheiro.zero(), (c) => real.get(c) ?? Dinheiro.zero());
    expect(a[0]!.filhos.map((f) => f.classificacao)).toEqual(['4.1', '4.2']);
    const sem = a[0]!.filhos[1]!.filhos[0]!.filhos[0]!.filhos[0]!;
    expect([sem.classificacao, sem.orcado.paraString(), sem.saldo.paraString(), sem.semaforo]).toEqual(['4.2.1.1.001', '0.00', '-50.00', 'VERMELHO']);
    const f = a[0]!.filhos[0]!.filhos[0]!.filhos[0]!.filhos[1]!;
    expect([f.saldo.paraString(), f.semaforo]).toEqual(['10.00', 'LARANJA']);
  });

  it('a conta fora do plano ativo vai à parte; o zero é ignorado (Review Focus 5)', () => {
    const r = separarPorPlano(
      new Map([
        ['4.1.1.1.001', d('10.00')],
        ['9.9.9.9.999', d('5.00')],
        ['4.1.1.1.002', d('0.00')],
      ]),
      (c) => c.startsWith('4.'),
    );
    expect([...r.dentro.keys()]).toEqual(['4.1.1.1.001']);
    expect(r.fora.map((f) => [f.conta, f.valor.paraString()])).toEqual([['9.9.9.9.999', '5.00']]);
  });
});
