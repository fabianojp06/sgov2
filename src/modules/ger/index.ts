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
// Impeditivos de exclusão (US-023): o caso de uso devolve, a AcaoConfirmada lista.
export { CAMPO_IMPEDITIVO, impeditivos, type Impeditivo } from './domain/impeditivos';
export { ErroDoCampo, Formulario, LegendaComErro, type PropsFormulario } from './ui/formulario';
export {
  aplicarFiltros,
  lerFiltrosSalvos,
  validarValoresFiltro,
  type DefinicaoFiltro,
  type ValoresFiltro,
} from './ui/grade-filtros';
// Os geradores de arquivo saem só pelo servidor.ts: o exportarXlsx, porque o ExcelJS não entra no navegador
// (R22), e o exportarCsv pela mesma regra do contrato (exportação chamada de application/).
export {
  criarIdentificacao,
  LIMITE_EXPORTACAO_SINCRONA,
  linhasIdentificacao,
  validarPlanilhas,
  type FiltroExportacao,
  type IdentificacaoExportacao,
  type PlanilhaExportacao,
} from './infrastructure/exportacao';

// Falsos para os testes dos consumidores.
export { emailFalso, exportarCsvFalso, exportarXlsxFalso, type EnvioFalso } from './falsos';

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

// Download das exportações pelas rotas GET das telas (US-024): origem, tipos e a resposta.
export {
  ehFormatoArquivo,
  origemDeExportacaoValida,
  respostaDeAgendamento,
  respostaDeArquivo,
  respostaDeErro,
  TIPOS_ARQUIVO,
  type FormatoArquivo,
} from './application/download';
