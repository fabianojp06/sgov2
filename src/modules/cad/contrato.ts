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

// C2 — Custo de pessoal (Task 3).
export {
  COMPONENTES_FIXOS,
  type AdicionalTrabalhista,
  type BeneficioPremissa,
  type CodigoComponente,
  type ComponenteEncargo,
  type ComponenteFixo,
  type LinhaComponente,
  type PosicaoPessoal,
  type PremissasExercicio,
  type SerieMensalComponentes,
} from './domain/custo-pessoal';
export {
  calcularCustoPosicao,
  congelarPremissasExercicio,
  garantirPremissasExercicio,
  obterPremissasExercicio,
} from './infrastructure/premissas';

export {
  CENTROS_CUSTO_EXEMPLO,
  CONTAS_EXEMPLO,
  custoPessoalFalso,
  estruturaFinanceiraFalsa,
  premissasExemplo,
} from './falsos';
