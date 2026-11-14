import { describe, expect, it } from 'vitest';
import { Dinheiro } from '@/shared/kernel';
import { agregarAdmCentral, diretoriaDoCc, type ExercicioEntrada, type PosicaoEntrada } from './quadro-adm-central';

// Parte 2 da US-107: posições da Administração Central por diretoria, com as regras de custo da parte 1.
const pos = (cc: string, quantidade: number, valor: string | null, extra: Partial<PosicaoEntrada> = {}): PosicaoEntrada => ({
  cc,
  quantidade,
  mesInicio: 1,
  mesSaida: 12,
  valorAnual: valor === null ? null : Dinheiro.de(valor),
  ...extra,
});
const ex = (ano: number, posicoes: PosicaoEntrada[], veSalario = true): ExercicioEntrada => ({ ano, situacao: 'Em elaboração', veSalario, posicoes });
const NOMES: Record<string, string> = { '4.3': 'Diretoria Administrativa Financeira', '4.4': 'Suporte Administrativo' };
const nome = (cc: string) => NOMES[cc] ?? cc;

describe('agregarAdmCentral', () => {
  it('diretoria = CC de nível 2; postos somam as quantidades; dezembro só com saída em 12; anos em ordem', () => {
    expect([diretoriaDoCc('4.3.2.11'), diretoriaDoCc('4.4'), diretoriaDoCc('4')]).toEqual(['4.3', '4.4', '4']);
    const q = agregarAdmCentral(
      [
        ex(2028, [pos('4.3.0', 2, '200000.00'), pos('4.3.2.11', 1, '90000.00', { mesSaida: 6 }), pos('4.4', 1, '50000.00')]),
        ex(2027, [pos('4.3.0', 1, '100000.00')]),
      ],
      nome,
    );
    expect(q.exercicios.map((e) => e.ano)).toEqual([2027, 2028]);
    const d = q.exercicios[1]!.diretorias;
    expect(d.map((x) => [x.diretoria, x.nome, x.postos, x.postosDezembro])).toEqual([
      ['4.3', 'Diretoria Administrativa Financeira', 3, 2],
      ['4.4', 'Suporte Administrativo', 1, 1],
    ]);
    expect(q.exercicios[1]).toMatchObject({ postos: 4, postosDezembro: 3 });
  });

  it('custo só com 3 ou mais pessoas, todas calculadas e com custo por pessoa diferente; o total soma só os exibidos', () => {
    const q = agregarAdmCentral(
      [
        ex(2028, [
          // 4.3: 2 posições, 3 pessoas, por pessoa 100.000 e 90.000: exibe.
          pos('4.3.0', 2, '200000.00'),
          pos('4.3.2.11', 1, '90000.00'),
          // 4.4: 3 pessoas na mesma posição: o custo por pessoa é o total ÷ 3 (homogeneidade).
          pos('4.4', 3, '150000.00'),
          // 4.5: 1 pessoa; 4.6: uma posição sem custo calculado.
          pos('4.5', 1, '80000.00'),
          pos('4.6.1', 2, '10.00'),
          pos('4.6.2', 2, '0.00'),
        ]),
      ],
      nome,
    );
    expect(q.exercicios[0]!.diretorias.map((x) => [x.diretoria, x.custoAnual, x.semCusto])).toEqual([
      ['4.3', '290000.00', null],
      ['4.4', null, 'CUSTOS_IGUAIS'],
      ['4.5', null, 'POUCOS_POSTOS'],
      ['4.6', null, 'CUSTO_INCOMPLETO'],
    ]);
    expect(q.exercicios[0]!.custoAnualExibido).toBe('290000.00');
    const sem = agregarAdmCentral([ex(2028, [pos('4.3.0', 2, null), pos('4.3.1', 2, null)], false)], nome);
    expect(sem.exercicios[0]!.diretorias[0]).toMatchObject({ custoAnual: null, semCusto: 'SEM_PERMISSAO' });
  });

  it('revisão 12.12: o custo sai só no exercício escolhido; o anterior vai só com os postos (a diferença daria o custo de quem entrou)', () => {
    const q = agregarAdmCentral(
      [
        ex(2027, [pos('4.3.0', 3, '280000.00'), pos('4.3.1', 1, '90000.00')]),
        ex(2028, [pos('4.3.0', 3, '280000.00'), pos('4.3.1', 1, '90000.00'), pos('4.3.2', 1, '95000.00')]),
      ],
      nome,
    );
    expect(q.exercicios.map((e) => [e.ano, e.postos, e.custoAnualExibido, e.diretorias[0]!.semCusto])).toEqual([
      [2027, 4, null, 'SO_POSTOS'],
      [2028, 5, '465000.00', null],
    ]);
    expect(JSON.stringify(q)).not.toContain('370000');
  });

  it('salários iguais com meses diferentes: o custo por pessoa-mês é igual, então omitido', () => {
    // 2 pessoas o ano todo e 1 de janeiro a junho, todas a 10.000 por mês.
    const q = agregarAdmCentral([ex(2028, [pos('4.3.0', 2, '240000.00'), pos('4.3.1', 1, '60000.00', { mesSaida: 6 })])], nome);
    expect(q.exercicios[0]!.diretorias[0]).toMatchObject({ postos: 3, custoAnual: null, semCusto: 'CUSTOS_IGUAIS' });
  });

  it('posição fora da raiz 4 não entra na Administração Central', () => {
    const q = agregarAdmCentral([ex(2028, [pos('9.1', 5, '1.00'), pos('4', 1, '1.00')])], nome);
    expect(q.exercicios[0]!.diretorias.map((d) => d.diretoria)).toEqual(['4']);
  });
});
