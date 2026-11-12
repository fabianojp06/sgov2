import type { IndiceEstruturaFinanceira } from '@/modules/cad/servidor';
import type { DepsOrc } from './deps';

// O orçamento da Adm. Central (UC04.17) é só a estrutura 4, das áreas internas (C37): os CCs de TP ficam
// numa estrutura própria da árvore e são da proposta (R4). Toda leitura do C1 pelo orc da Adm. Central
// passa por este filtro (resolverDeps), e um CC fora da raiz 4 é como se não existisse: não aparece na
// visão, nas opções nem na consolidação, e a gravação e a importação o recusam como não analítico.

export const RAIZ_ADM_CENTRAL = '4';

export const daAdmCentral = (cc: string) => cc === RAIZ_ADM_CENTRAL || cc.startsWith(`${RAIZ_ADM_CENTRAL}.`);

function indiceDaAdmCentral(i: IndiceEstruturaFinanceira): IndiceEstruturaFinanceira {
  return {
    ...i,
    centroCustoAnalitico: (cc) => daAdmCentral(cc) && i.centroCustoAnalitico(cc),
    centrosCustoAnaliticosSob: (raiz) => (daAdmCentral(raiz) ? i.centrosCustoAnaliticosSob(raiz) : []),
    nosCentrosCusto: i.nosCentrosCusto.filter((n) => daAdmCentral(n.id)),
  };
}

/** A estrutura do C1 vista pela Adm. Central: as contas inteiras; dos CCs, só a raiz 4. */
export function estruturaDaAdmCentral(e: DepsOrc['estrutura']): DepsOrc['estrutura'] {
  return {
    carregarIndiceEstrutura: async (...args) => indiceDaAdmCentral(await e.carregarIndiceEstrutura(...args)),
    listarArvoreCentrosCusto: async (...args) => (await e.listarArvoreCentrosCusto(...args)).filter((n) => n.classificacao === RAIZ_ADM_CENTRAL),
    listarArvoreContas: e.listarArvoreContas,
  };
}
