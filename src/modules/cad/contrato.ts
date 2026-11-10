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
  QUANTIDADE_MAXIMA,
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
export { calcularEncargo } from './domain/motor-custo-pessoal';
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

// Resumo dos cadastros para a conferência da carga (plano do P7, Task 2): os tipos. A função sai
// pelo index.ts (application/, com server-only), nunca pelo servidor.ts (worker e seed).
export type { ContagemNivel, ResumoCadastros, SomaSalarios } from './infrastructure/resumo-cadastros';

// Parâmetros por exercício (Task 9a): semáforo (RN_PLA_006) e tipos da tela.
export { classificarSemaforo, type FaixaSemaforo, type FaixasSemaforo } from './domain/semaforo';
export type { EntradaParametros, ParametrosExercicio } from './domain/parametros';

// Máscara dos salários no Histórico (R24; pedido do P8, D-P8-10): função pura para a tela do Histórico.
export { mascararHistoricoCad, VALOR_MASCARADO, type HistoricoMascarado } from './domain/mascara-historico';
