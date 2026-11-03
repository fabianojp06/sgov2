// API pública do módulo ger (spec §4.1): outros módulos só importam daqui.

// Contrato C3: componentes de tela e exportação.
export {
  CELULA_INVALIDA,
  celulaCompetencia,
  celulaData,
  celulaDataSemHora,
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
export { AcaoConfirmada, MENSAGEM_FALHA_ACAO, type AcaoFormulario } from './ui/acao-confirmada';
export { ErroDoCampo, Formulario, LegendaComErro, type PropsFormulario } from './ui/formulario';
export {
  aplicarFiltros,
  lerFiltrosSalvos,
  validarValoresFiltro,
  type DefinicaoFiltro,
  type ValoresFiltro,
} from './ui/grade-filtros';
export {
  exportarXlsx,
  LIMITE_EXPORTACAO_SINCRONA,
  type PlanilhaExportacao,
} from './infrastructure/exportar-xlsx';

// Falsos para os testes dos consumidores.
export { emailFalso, exportarXlsxFalso, type EnvioFalso } from './falsos';

// Contrato C4: e-mail por outbox.
export {
  MODELOS_SENSIVEIS,
  SENSIBILIDADE_MODELO,
  VALIDADE_MENSAGEM_SENSIVEL_MS,
  VERSAO_ATUAL,
  type DadosModeloEmail,
  type Destinatario,
  type MensagemEmail,
  type ModeloEmail,
} from './domain/modelos-email';
export { enviarEmail } from './application/email';
