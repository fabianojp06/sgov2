// API pública do módulo ger (spec §4.1): outros módulos só importam daqui.

// Contrato C3: componentes de tela e exportação.
export {
  CELULA_INVALIDA,
  celulaCompetencia,
  celulaData,
  celulaDinheiro,
  celulaPercentual,
  formatarCelula,
  type TipoColuna,
  type ValorCelula,
} from './domain/celula';
export {
  GradeArvore,
  type ColunaGrade,
  type LinhaGrade,
  type NoGrade,
  type PropsGradeArvore,
} from './ui/grade-arvore';
export { ErroDoCampo, Formulario, type PropsFormulario } from './ui/formulario';
export {
  exportarXlsx,
  LIMITE_EXPORTACAO_SINCRONA,
  type PlanilhaExportacao,
} from './infrastructure/exportar-xlsx';

// Falsos para os testes dos consumidores.
export { exportarXlsxFalso } from './falsos';
