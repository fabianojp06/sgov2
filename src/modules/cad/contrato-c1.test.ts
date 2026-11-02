import { describe, expect, it } from 'vitest';
import type { TxCliente } from '@/shared/db';
import { totalizar } from '@/shared/totalizer';
import * as cad from '@/modules/cad';
import * as cadServidor from '@/modules/cad/servidor';
import {
  carregarIndiceEstrutura,
  CENTROS_CUSTO_EXEMPLO,
  compararClassificacao,
  CONTAS_EXEMPLO,
  ehCentroCustoAnalitico,
  ehContaAnaliticaAtiva,
  estruturaFinanceiraFalsa,
  listarArvoreCentrosCusto,
  listarArvoreContas,
  type NoCentroCusto,
  type NoConta,
} from '@/modules/cad';

// Contrato C1 (plano do P4, Task 2): estrutura financeira do cad.
const tx = {} as TxCliente;

describe('C1 — falso', () => {
  const falso = estruturaFinanceiraFalsa();

  it('conta analítica ativa', async () => {
    expect(await falso.ehContaAnaliticaAtiva(tx, '4.1.1.1.001')).toBe(true);
    expect(await falso.ehContaAnaliticaAtiva(tx, '4.1.1.1')).toBe(false);
    expect(await falso.ehContaAnaliticaAtiva(tx, '9.9.9.9.999')).toBe(false);
  });

  it('centro de custo analítico', async () => {
    expect(await falso.ehCentroCustoAnalitico(tx, '4.3.2')).toBe(false);
    expect(await falso.ehCentroCustoAnalitico(tx, '4.4')).toBe(true);
  });

  it('índice: subárvores na ordem da classificação', async () => {
    const indice = await falso.carregarIndiceEstrutura(tx);
    expect(indice.centrosCustoAnaliticosSob('4.3')).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11']);
    expect(indice.contasAnaliticasSob('4.1.1.1')).toEqual(['4.1.1.1.001', '4.1.1.1.003', '4.1.1.1.005']);
    // Raiz analítica entra; raiz inexistente não vira "tudo".
    expect(indice.centrosCustoAnaliticosSob('4.4')).toEqual(['4.4']);
    expect(indice.centrosCustoAnaliticosSob('9')).toEqual([]);
  });

  it('nosContas e nosCentrosCusto passam no totalizar()', async () => {
    const indice = await falso.carregarIndiceEstrutura(tx);
    expect(totalizar(indice.nosContas, new Map()).total.paraString()).toBe('0.00');
    expect(totalizar(indice.nosCentrosCusto, new Map()).total.paraString()).toBe('0.00');
    expect(indice.nosCentrosCusto.find((n) => n.id === '4.4')).toEqual({ id: '4.4', paiId: '4', tipo: 'ANALITICA' });
  });

  it('CCs de gestão da minuta (R17)', () => {
    const gestao: string[] = [];
    const visitar = (n: NoCentroCusto) => {
      if (n.deGestao) gestao.push(n.classificacao);
      n.filhos.forEach(visitar);
    };
    CENTROS_CUSTO_EXEMPLO.forEach(visitar);
    expect(gestao).toEqual(['4.3.0', '4.3.2.10']);
  });

  it('inativos: fora por padrão, presentes com incluirInativos', async () => {
    const contas: NoConta[] = [
      {
        ...CONTAS_EXEMPLO[0]!,
        filhos: [
          {
            classificacao: '4.9',
            codigoReduzido: null,
            descricao: 'Inativa',
            nivel: 2,
            tipo: 'SINTETICA',
            ativa: false,
            filhos: [],
          },
          ...CONTAS_EXEMPLO[0]!.filhos,
        ],
      },
    ];
    const f = estruturaFinanceiraFalsa({ contas });
    const ativas = await f.listarArvoreContas(tx);
    expect(ativas[0]!.filhos.map((c) => c.classificacao)).toEqual(['4.1']);
    const todas = await f.listarArvoreContas(tx, { incluirInativos: true });
    expect(todas[0]!.filhos.map((c) => c.classificacao)).toEqual(['4.1', '4.9']);
  });

  it('ordem por segmentos numéricos', () => {
    expect(['4.3.2.10', '4.3.2.9', '4.3', '4.10'].sort(compararClassificacao)).toEqual(['4.3', '4.3.2.9', '4.3.2.10', '4.10']);
  });
});

describe('C1 — reais antes da Task 4b', () => {
  it.each([
    ['listarArvoreContas', () => listarArvoreContas(tx)],
    ['listarArvoreCentrosCusto', () => listarArvoreCentrosCusto(tx)],
    ['ehContaAnaliticaAtiva', () => ehContaAnaliticaAtiva(tx, '4.1.1.1.001')],
    ['ehCentroCustoAnalitico', () => ehCentroCustoAnalitico(tx, '4.4')],
    ['carregarIndiceEstrutura', () => carregarIndiceEstrutura(tx)],
  ])('%s → cad.estrutura_indisponivel', async (_nome, chamar) => {
    await expect(chamar()).rejects.toMatchObject({ name: 'ErroDominio', codigo: 'cad.estrutura_indisponivel' });
  });
});

describe('C1 — tipos e exportações', () => {
  it('nível fora de 1..5 não compila', () => {
    const no: NoConta = {
      classificacao: '4.1.1.1.001.1',
      codigoReduzido: '1',
      descricao: 'x',
      // @ts-expect-error nível 6 não existe (spec §6.1)
      nivel: 6,
      tipo: 'ANALITICA',
      ativa: true,
      filhos: [],
    };
    expect(no).toBeDefined();
  });

  it('index.ts e servidor.ts exportam o C1 inteiro, inclusive os falsos', () => {
    const nomes = [
      'listarArvoreContas',
      'listarArvoreCentrosCusto',
      'ehContaAnaliticaAtiva',
      'ehCentroCustoAnalitico',
      'carregarIndiceEstrutura',
      'CONTAS_EXEMPLO',
      'CENTROS_CUSTO_EXEMPLO',
      'estruturaFinanceiraFalsa',
    ];
    for (const nome of nomes) {
      expect(cad).toHaveProperty(nome);
      expect(cadServidor).toHaveProperty(nome);
    }
  });
});
