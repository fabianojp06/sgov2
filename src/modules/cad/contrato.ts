// Contratos públicos do cad, reexportados pelo index.ts e pelo servidor.ts (R22).

// C1 — Estrutura financeira (Task 2).
export {
  compararClassificacao,
  type IndiceEstruturaFinanceira,
  type NoIndice,
  type NaturezaCentroCusto,
  type Nivel,
  type NoCentroCusto,
  type NoConta,
  type OpcoesArvore,
  type TipoCentroCusto,
  type TipoConta,
} from './domain/estrutura';
export {
  carregarIndiceEstrutura,
  ehCentroCustoAnalitico,
  ehContaAnaliticaAtiva,
  listarArvoreCentrosCusto,
  listarArvoreContas,
} from './infrastructure/estrutura-financeira';
export { CENTROS_CUSTO_EXEMPLO, CONTAS_EXEMPLO, estruturaFinanceiraFalsa } from './falsos';
