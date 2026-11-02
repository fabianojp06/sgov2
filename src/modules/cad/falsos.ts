import {
  montarIndice,
  prepararArvoreCentrosCusto,
  prepararArvoreContas,
  type NoCentroCusto,
  type NoConta,
} from './domain/estrutura';
import type {
  carregarIndiceEstrutura,
  ehCentroCustoAnalitico,
  ehContaAnaliticaAtiva,
  listarArvoreCentrosCusto,
  listarArvoreContas,
} from './infrastructure/estrutura-financeira';

// Adaptadores falsos dos contratos do cad, só para testes dos módulos consumidores (spec §12.6).

const conta = (classificacao: string, descricao: string, codigoReduzido: string | null, filhos: NoConta[] = []): NoConta => {
  const nivel = classificacao.split('.').length as NoConta['nivel'];
  return { classificacao, codigoReduzido, descricao, nivel, tipo: nivel === 5 ? 'ANALITICA' : 'SINTETICA', ativa: true, filhos };
};

/** Trecho real do plano de contas oficial de 5 níveis (spec §6.1). */
export const CONTAS_EXEMPLO: readonly NoConta[] = [
  conta('4', 'DESPESAS', null, [
    conta('4.1', 'DESPESAS OPERACIONAIS', null, [
      conta('4.1.1', 'DESPESAS DE SERVIÇOS', null, [
        conta('4.1.1.1', 'DESPESAS DE PESSOAL', null, [
          conta('4.1.1.1.001', 'Salários', '900'),
          conta('4.1.1.1.003', 'Férias', '920'),
          conta('4.1.1.1.005', '13 Salário', '940'),
        ]),
        conta('4.1.1.2', 'ENCARGOS SOCIAIS', null, [conta('4.1.1.2.001', 'INSS', '981')]),
        conta('4.1.1.5', 'DESPESAS ADMINISTRATIVAS', null, [conta('4.1.1.5.005', 'Material de escritório', '1270')]),
      ]),
    ]),
  ]),
];

const cc = (
  classificacao: string,
  codigoReduzido: string,
  descricao: string,
  analitico: boolean,
  filhos: NoCentroCusto[] = [],
): NoCentroCusto => {
  const nivel = classificacao.split('.').length as NoCentroCusto['nivel'];
  // R17: analítico com sufixo .0 no nível 3 ou .10 no nível 4 é de gestão.
  const deGestao = analitico && ((nivel === 3 && classificacao.endsWith('.0')) || (nivel === 4 && classificacao.endsWith('.10')));
  return {
    classificacao,
    codigoReduzido,
    descricao,
    nivel,
    tipo: analitico ? 'ANALITICO' : 'SINTETICO',
    ativo: true,
    deGestao,
    natureza: null,
    provisorio: true,
    filhos,
  };
};

/** Trecho real da minuta do plano de centros de custo (Rev23102026), ainda sem aprovação da DIREX. */
export const CENTROS_CUSTO_EXEMPLO: readonly NoCentroCusto[] = [
  cc('4', '14.180', 'DIREX', false, [
    cc('4.3', '14.310', 'Diretoria Administrativa Financeira', false, [
      cc('4.3.0', '14.500', 'Gabinete da Diretoria Administrativa Financeira', true),
      cc('4.3.2', '14.360', 'Gerência Financeira', false, [
        cc('4.3.2.10', '14.520', 'Gestão da Gerência Financeira', true),
        cc('4.3.2.11', '14.370', 'Setor de Controle Orçamentário', true),
      ]),
    ]),
    cc('4.4', '14.450', 'Suporte Administrativo', true),
  ]),
];

/**
 * Falso do C1: mesma semântica dos reais (só ativos por padrão, filhos ordenados pela
 * classificação, analítico e ativo), sobre árvores em memória. Ignora a transação.
 */
export function estruturaFinanceiraFalsa(dados: { contas?: readonly NoConta[]; centrosCusto?: readonly NoCentroCusto[] } = {}): {
  listarArvoreContas: typeof listarArvoreContas;
  listarArvoreCentrosCusto: typeof listarArvoreCentrosCusto;
  ehContaAnaliticaAtiva: typeof ehContaAnaliticaAtiva;
  ehCentroCustoAnalitico: typeof ehCentroCustoAnalitico;
  carregarIndiceEstrutura: typeof carregarIndiceEstrutura;
} {
  const contas = dados.contas ?? CONTAS_EXEMPLO;
  const centrosCusto = dados.centrosCusto ?? CENTROS_CUSTO_EXEMPLO;
  const indice = montarIndice(contas, centrosCusto);
  return {
    listarArvoreContas: async (_tx, opcoes) => prepararArvoreContas(contas, opcoes),
    listarArvoreCentrosCusto: async (_tx, opcoes) => prepararArvoreCentrosCusto(centrosCusto, opcoes),
    ehContaAnaliticaAtiva: async (_tx, classificacao) => indice.contaAnaliticaAtiva(classificacao),
    ehCentroCustoAnalitico: async (_tx, classificacao) => indice.centroCustoAnalitico(classificacao),
    carregarIndiceEstrutura: async () => indice,
  };
}
