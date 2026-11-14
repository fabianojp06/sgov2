import { describe, expect, it } from 'vitest';
import type { TxCliente } from '@/shared/db';
import { Dinheiro } from '@/shared/kernel';
import { totalizar } from '@/shared/totalizer';
import * as cad from '@/modules/cad';
import * as cadServidor from '@/modules/cad/servidor';
import {
  CENTROS_CUSTO_EXEMPLO,
  CENTROS_CUSTO_TPS_EXEMPLO,
  compararClassificacao,
  CONTAS_CAPEX_EXEMPLO,
  CONTAS_EXEMPLO,
  estruturaFinanceiraFalsa,
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

  it('nosContas e nosCentrosCusto alimentam o totalizar()', async () => {
    const indice = await falso.carregarIndiceEstrutura(tx);
    const valores = new Map([
      ['4.1.1.1.001', Dinheiro.de('100.00')],
      ['4.1.1.2.001', Dinheiro.de('38.00')],
    ]);
    const r = totalizar(indice.nosContas, valores);
    expect(r.valor('4.1.1.1').paraString()).toBe('100.00');
    expect(r.valor('4').paraString()).toBe('138.00');
    expect(totalizar(indice.nosCentrosCusto, new Map([['4.4', Dinheiro.de('1.00')]])).total.paraString()).toBe('1.00');
    expect(indice.nosCentrosCusto.find((n) => n.id === '4.4')).toEqual({ id: '4.4', paiId: '4', tipo: 'ANALITICA' });
  });

  it('o índice e os exemplos são imutáveis (compartilhados entre testes)', async () => {
    const indice = await falso.carregarIndiceEstrutura(tx);
    expect(() => {
      (indice.nosContas[0] as { tipo: string }).tipo = 'ANALITICA';
    }).toThrow(TypeError);
    expect(() => {
      (CONTAS_EXEMPLO[0] as { ativa: boolean }).ativa = false;
    }).toThrow(TypeError);
    expect(() => {
      (indice.centrosCustoAnaliticosSob('4.3') as string[]).push('4');
    }).toThrow(TypeError);
    expect(indice.centrosCustoAnaliticosSob('4.3')).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11']);
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

  // Ativo efetivo: o nó e todos os ancestrais ativos (OpcoesArvore, M-n3).
  const contaInativa = (classificacao: string, filhos: NoConta[] = []): NoConta => ({
    classificacao,
    codigoReduzido: filhos.length === 0 ? '9999' : null,
    descricao: 'Inativa',
    nivel: classificacao.split('.').length as NoConta['nivel'],
    tipo: filhos.length === 0 ? 'ANALITICA' : 'SINTETICA',
    ativa: false,
    filhos,
  });
  const contasComInativas: NoConta[] = [
    {
      ...CONTAS_EXEMPLO[0]!,
      filhos: [
        // Sintético inativo com uma analítica ativa embaixo: a analítica não vale.
        contaInativa('4.9', [
          {
            ...contaInativa('4.9.1', [{ ...contaInativa('4.9.1.1', [{ ...contaInativa('4.9.1.1.001'), ativa: true }]), ativa: true }]),
            ativa: true,
          },
        ]),
        ...CONTAS_EXEMPLO[0]!.filhos,
      ],
    },
  ];
  const ccInativo: NoCentroCusto = {
    classificacao: '4.5',
    codigoReduzido: '14.999',
    descricao: 'Inativo',
    nivel: 2,
    tipo: 'ANALITICO',
    ativo: false,
    deGestao: false,
    natureza: null,
    provisorio: true,
    filhos: [],
  };
  const ccsComInativo: NoCentroCusto[] = [{ ...CENTROS_CUSTO_EXEMPLO[0]!, filhos: [...CENTROS_CUSTO_EXEMPLO[0]!.filhos, ccInativo] }];

  it('inativos: fora por padrão, presentes com incluirInativos', async () => {
    const f = estruturaFinanceiraFalsa({ contas: contasComInativas, centrosCusto: ccsComInativo });
    expect((await f.listarArvoreContas(tx))[0]!.filhos.map((c) => c.classificacao)).toEqual(['4.1']);
    expect((await f.listarArvoreContas(tx, { incluirInativos: true }))[0]!.filhos.map((c) => c.classificacao)).toEqual(['4.1', '4.9']);
    expect((await f.listarArvoreCentrosCusto(tx))[0]!.filhos.map((c) => c.classificacao)).toEqual(['4.3', '4.4']);
    expect((await f.listarArvoreCentrosCusto(tx, { incluirInativos: true }))[0]!.filhos.map((c) => c.classificacao)).toEqual([
      '4.3',
      '4.4',
      '4.5',
    ]);
  });

  it('inativos: o índice e as consultas nunca os tratam como válidos', async () => {
    const f = estruturaFinanceiraFalsa({ contas: contasComInativas, centrosCusto: ccsComInativo });
    expect(await f.ehContaAnaliticaAtiva(tx, '4.9.1.1.001')).toBe(false);
    expect(await f.ehCentroCustoAnalitico(tx, '4.5')).toBe(false);
    const indice = await f.carregarIndiceEstrutura(tx);
    expect(indice.contasAnaliticasSob('4.9')).toEqual([]);
    expect(indice.contasAnaliticasSob('4')).not.toContain('4.9.1.1.001');
    expect(indice.centrosCustoAnaliticosSob('4.5')).toEqual([]);
    expect(indice.nosContas.map((n) => n.id)).not.toContain('4.9');
  });

  it('escopo do Gestor nunca vira "tudo": raiz vazia, com espaço ou inexistente → []', async () => {
    const indice = await falso.carregarIndiceEstrutura(tx);
    for (const raiz of ['', ' 4.3', '4.3 ', '*', '__proto__', '4.']) {
      expect(indice.centrosCustoAnaliticosSob(raiz)).toEqual([]);
    }
  });

  it('o índice ordena pela classificação mesmo com a entrada fora de ordem', async () => {
    const raiz = CENTROS_CUSTO_EXEMPLO[0]!;
    const r43 = raiz.filhos[0]!;
    const embaralhado: NoCentroCusto[] = [
      { ...raiz, filhos: [raiz.filhos[1]!, { ...r43, filhos: [{ ...r43.filhos[1]!, filhos: [...r43.filhos[1]!.filhos].reverse() }, r43.filhos[0]!] }] },
    ];
    const indice = await estruturaFinanceiraFalsa({ centrosCusto: embaralhado }).carregarIndiceEstrutura(tx);
    expect(indice.centrosCustoAnaliticosSob('4')).toEqual(['4.3.0', '4.3.2.10', '4.3.2.11', '4.4']);
  });

  it('ordem por segmentos numéricos', () => {
    expect(['4.3.2.10', '4.3.2.9', '4.3', '4.10'].sort(compararClassificacao)).toEqual(['4.3', '4.3.2.9', '4.3.2.10', '4.10']);
    // Ordem total: sem empate entre textos diferentes, e não numérico depois dos numéricos.
    expect(compararClassificacao('4.01', '4.1')).not.toBe(0);
    expect(compararClassificacao('4.1', '4.1')).toBe(0);
    expect(['4.x', '4.2'].sort(compararClassificacao)).toEqual(['4.2', '4.x']);
  });
});

// Os reais (contas e CCs) são provados nos testes de integração (Tasks 4b e 5).
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
      // Estrutura sintética de TPs (C37, #138).
      'CENTROS_CUSTO_TPS_EXEMPLO',
      // Natureza OPEX/CAPEX (US-072, #138).
      'CONTAS_CAPEX_EXEMPLO',
      'NATUREZAS_CONTA',
      'estruturaFinanceiraFalsa',
      'compararClassificacao',
    ];
    for (const nome of nomes) {
      expect(cad).toHaveProperty(nome);
      expect(cadServidor).toHaveProperty(nome);
    }
  });
});

describe('C1 — estrutura sintética de TPs (C37)', () => {
  it('raiz 9 fora da estrutura 4; junto da minuta, os analíticos de cada raiz saem separados', async () => {
    const falso = estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, ...CENTROS_CUSTO_TPS_EXEMPLO] });
    const indice = await falso.carregarIndiceEstrutura(tx);
    expect(indice.centrosCustoAnaliticosSob('9')).toEqual(['9.1', '9.2', '9.3']);
    expect(indice.centrosCustoAnaliticosSob('4')).not.toContain('9.1');
    expect(await falso.ehCentroCustoAnalitico(tx, '9.2')).toBe(true);
    expect(await falso.ehCentroCustoAnalitico(tx, '9')).toBe(false);
  });
});

describe('C1 — natureza OPEX/CAPEX da conta (US-045; pedido da US-072)', () => {
  it('só a analítica ativa CAPEX passa; OPEX, sem natureza, sintética e inexistente não', async () => {
    const falso = estruturaFinanceiraFalsa({ contas: [...CONTAS_EXEMPLO, ...CONTAS_CAPEX_EXEMPLO] });
    const indice = await falso.carregarIndiceEstrutura(tx);
    expect(indice.contaAnaliticaCapex('1.2.3.1.001')).toBe(true);
    for (const c of ['1.2.3.1.002', '1.2.3.1.003', '1.2.3.1', '4.1.1.1.001', '9.9.9']) expect(indice.contaAnaliticaCapex(c)).toBe(false);
    const sob = indice.contasAnaliticasSob('1').filter((c) => indice.contaAnaliticaCapex(c));
    expect(sob).toEqual(['1.2.3.1.001']);
    const arvore = await falso.listarArvoreContas(tx);
    const bens = arvore.find((n) => n.classificacao === '1')!.filhos[0]!.filhos[0]!.filhos[0]!;
    expect(bens.filhos.map((n) => n.natureza ?? null)).toEqual(['CAPEX', 'OPEX', null]);
  });

  it('CAPEX inativa não passa', async () => {
    const inativa: NoConta = { ...CONTAS_CAPEX_EXEMPLO[0]!.filhos[0]!.filhos[0]!.filhos[0]!.filhos[0]!, ativa: false };
    expect(inativa.natureza).toBe('CAPEX');
    const raiz = CONTAS_CAPEX_EXEMPLO[0]!;
    const trocar = (n: NoConta): NoConta => (n.classificacao === inativa.classificacao ? inativa : { ...n, filhos: n.filhos.map(trocar) });
    const indice = await estruturaFinanceiraFalsa({ contas: [trocar(raiz)] }).carregarIndiceEstrutura(tx);
    expect(indice.contaAnaliticaCapex('1.2.3.1.001')).toBe(false);
  });
});
