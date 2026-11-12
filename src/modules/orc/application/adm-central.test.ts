import { describe, expect, it } from 'vitest';
import { CENTROS_CUSTO_EXEMPLO, estruturaFinanceiraFalsa, type NoCentroCusto } from '@/modules/cad/servidor';
import { daAdmCentral, estruturaDaAdmCentral } from './adm-central';
import { resolverDeps } from './deps';

// O orc da Adm. Central vê só a raiz 4 do C1 (C37): os CCs de TP (estrutura própria, aqui a 9 sintética da
// seed de referência) não aparecem nem são aceitos.
const no = (classificacao: string, analitico: boolean, filhos: NoCentroCusto[] = []): NoCentroCusto => ({
  classificacao,
  codigoReduzido: `90.${classificacao.replaceAll('.', '')}`,
  descricao: `TP ${classificacao}`,
  nivel: classificacao.split('.').length as NoCentroCusto['nivel'],
  tipo: analitico ? 'ANALITICO' : 'SINTETICO',
  ativo: true,
  deGestao: false,
  natureza: null,
  provisorio: false,
  filhos,
});
const TPS = no('9', false, [no('9.1', true), no('9.2', true)]);
const comTps = () => estruturaFinanceiraFalsa({ centrosCusto: [...CENTROS_CUSTO_EXEMPLO, TPS] });

describe('estrutura da Adm. Central (raiz 4)', () => {
  it('daAdmCentral: a raiz 4 e o que está sob ela; nada além', () => {
    expect(['4', '4.3', '4.3.2.11'].every(daAdmCentral)).toBe(true);
    expect(['9', '9.1', '41', '40.1', ''].some(daAdmCentral)).toBe(false);
  });

  it('o índice não reconhece CC de TP como analítico nem o lista', async () => {
    const completo = await comTps().carregarIndiceEstrutura({} as never);
    expect(completo.centroCustoAnalitico('9.1')).toBe(true);
    const i = await estruturaDaAdmCentral(comTps()).carregarIndiceEstrutura({} as never);
    expect(i.centroCustoAnalitico('9.1')).toBe(false);
    expect(i.centroCustoAnalitico('4.4')).toBe(true);
    expect(i.centrosCustoAnaliticosSob('9')).toEqual([]);
    expect(i.centrosCustoAnaliticosSob('4')).toEqual(completo.centrosCustoAnaliticosSob('4'));
    expect(i.nosCentrosCusto.map((n) => n.id).some((id) => id.startsWith('9'))).toBe(false);
    // As contas não mudam.
    expect(i.contasAnaliticasSob('4')).toEqual(completo.contasAnaliticasSob('4'));
    expect(i.nosContas).toEqual(completo.nosContas);
  });

  it('a árvore de CCs só traz a raiz 4', async () => {
    const arvore = await estruturaDaAdmCentral(comTps()).listarArvoreCentrosCusto({} as never);
    expect(arvore.map((n) => n.classificacao)).toEqual(['4']);
  });

  it('resolverDeps aplica o filtro também ao falso injetado; a estrutura completa fica em estruturaCompleta', async () => {
    const deps = resolverDeps({ estrutura: comTps() });
    expect((await deps.estrutura.listarArvoreCentrosCusto({} as never)).map((n) => n.classificacao)).toEqual(['4']);
    expect((await deps.estruturaCompleta.listarArvoreCentrosCusto({} as never)).map((n) => n.classificacao)).toEqual(['4', '9']);
  });
});
