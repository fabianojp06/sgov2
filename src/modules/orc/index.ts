// Entrada pública do orc (orçamento da Administração Central, UC04.17).
export { avancar, criar } from './application/acoes-exercicios';
export { aprovarAcao, enviarAcao, pedirRevisaoAcao, rejeitarAcao } from './application/acoes-aprovacao';
export { importarPlanilhaAcao } from './application/acoes-importacao';
export { carregarRealizadoAcao, fecharCompetenciaAcao, reprocessarPendenciasAcao } from './application/acoes-realizado';
export { definirTetoAcao, recalcularAcao } from './application/acoes-orcamento';
export { alterarPacoteAcao, excluirPacoteAcao, incluirPacoteAcao } from './application/acoes-pacotes';
export { destacarRiscosAcao, explicarDesvioAcao, sugerirContaCcAcao, sugerirJustificativaAcao, sugerirRecusaAcao } from './application/acoes-ia';
export { CASOS_IA_ORC } from './application/ia-casos';
export { iaLiberada } from './application/ia-deps';
export { AjudaRecusaIA } from './ui/ajuda-recusa-ia';
export { alterarPosicaoAcao, excluirPosicaoAcao, incluirPosicaoAcao, ligarCargoAcao, previaPosicaoAcao } from './application/acoes-posicoes';
export { alterarMetaAcao, excluirMetaAcao, incluirMetaAcao } from './application/acoes-metas';
export {
  alterarEmpregadoAcao,
  alterarQtdeAcao,
  excluirEmpregadoAcao,
  finalizarLotePessoalAcao,
  excluirQtdeAcao,
  incluirEmpregadoAcao,
  incluirQtdeAcao,
} from './application/acoes-empregados';
export { excluirRateioAcao, replicarRateioAcao, salvarRateioAcao } from './application/acoes-rateio';
export { alterarBemAcao, excluirBemAcao, incluirBemAcao } from './application/acoes-bens';
export {
  alterarTetoAcao,
  alterarViagemAcao,
  excluirTetoAcao,
  excluirViagemAcao,
  incluirTetoAcao,
  incluirViagemAcao,
  solicitarValidacaoViagensAcao,
} from './application/acoes-viagens';
export {
  avancarPropostaAcao,
  criarPropostaAcao,
  duplicarPropostaAcao,
  enviarPropostaAcao,
  excluirPropostaAcao,
  novaVersaoPropostaAcao,
} from './application/acoes-propostas';
export { disponibilidadeDoEnvio, manipuladorWa01 } from './application/oficializacao';
export { aprovadoresDoLote, manipuladorWa05, type SituacaoLote } from './application/lote-pessoal';
export { manipuladorWa02, validadoresDasViagens, type SituacaoViagem } from './application/lote-viagem';
export { alterarReceitaAcao, excluirReceitaAcao, incluirReceitaAcao } from './application/acoes-receitas';
export { listarTramites } from './application/aprovacao';
export { ultimaRevisao } from './application/revisor';
export type { Achado, RevisaoTela } from './domain/revisor-regras';
export { obterVisaoExercicio, type VisaoExercicio } from './application/consolidacao';
export { listarExercicios, sugerirAno, type ResumoExercicio } from './application/exercicios';
// Casos de uso com a guarda (exigir), para o teste de importação real dos arquivos do gerador da carga
// (P7, frente B, #138). Ficam fora do servidor.ts, que o worker empacota sem @/shared/authz.
export { avancarExercicio, criarExercicio, type ResultadoCriacao } from './application/exercicios';
export { importarPlanilha, type DepsImportacao, type ResultadoImportacao } from './application/importacao';
export { listarPacotes, opcoesPacote, type ListaPacotes, type OpcoesPacote, type PacoteTela } from './application/pacotes';
export {
  cargosParaPosicao,
  listarPosicoes,
  opcoesPosicao,
  type CargosPosicao,
  type ListaPosicoes,
  type OpcaoCargo,
  type OpcoesPosicao,
  type PosicaoTela,
} from './application/posicoes';
export { listarCorrespondencias, type ItemCorrespondencia, type ListaCorrespondencia } from './application/correspondencia-cargos';
export { listarMetas, type BlocoMetas, type FiltrosMetas, type MetaTela } from './application/metas';
export {
  cargosParaEmpregado,
  listarEmpregados,
  MAXIMO_PROPOSTAS_EMPREGADOS,
  type BlocoEmpregados,
  type FiltrosEmpregados,
  type EmpregadoTela,
  type GrupoEmpregados,
  type OpcaoCargoEmpregado,
} from './application/empregados';
export { listarQtdes, type BlocoQtdes, type QtdeTela } from './application/qtde-empregados';
export {
  listarViagens,
  opcoesViagem,
  type BlocoViagens,
  type FiltrosViagens,
  type GrupoViagens,
  type OpcoesViagem,
  type TetoTela,
  type ViagemTela,
} from './application/viagens';
export { exportarOrcadoRealizado, FORMATOS_OXR, MENSAGEM_PDF_LONGO, type FormatoOxr } from './application/exportar-oxr';
export { obterPrevisaoFechamento, type ResultadoPrevisao, type TelaPrevisao as DadosPrevisao } from './application/previsao-fechamento';
export { obterOrcadoRealizado, type FiltrosOxr, type ResultadoOxr, type TelaOxr as DadosOxr } from './application/orcado-realizado';
export {
  carregarRealizado,
  fecharCompetencia,
  obterTelaRealizado,
  propostasParaRealizado,
  realizadoPorTp,
  reprocessarPendencias,
  tpsDoRealizado,
  type AjusteDoRealizado,
  type LinhaRealizado,
  type RealizadoDoTp,
  type ResumoCarga,
  type ResumoReprocessamento,
  type TpDoRealizado,
} from './application/realizado';
export { obterCronograma, propostasParaCronograma, type CronogramaTela, type FiltrosCronograma, type PropostaParaCronograma } from './application/cronograma';
export { obterRateio, propostasParaRateio, type LinhaRateio, type PropostaParaRateio, type RateioTela } from './application/rateio';
export { obterTotalizadores, propostasParaTotalizar, type PropostaParaTotalizar, type TotalizadoresTela } from './application/totalizadores';
export { listarBens, opcoesBem, type BemTela, type BlocoBens, type FiltrosBens, type GrupoBens, type OpcoesBem } from './application/bens';
export { ccsLivresParaTp, dadosParaDuplicar, listarPropostas, type CcLivreTp, type DadosDuplicar, type PropostaTela } from './application/propostas';
export { listarReceitas, obterReceita, type ListaReceitas as DadosReceitas } from './application/receitas';
export { mascararHistoricoOrc, type HistoricoMascaradoOrc } from './domain/mascara-historico';
export { MENSAGENS_ORC } from './domain/mensagens';
export { FUNCIONALIDADES_ORC, seedOrc } from './infrastructure/seed';
export { FormReceita, type ReceitaFormulario } from './ui/form-receita';
export { TelaPacotes, textoAvisoPacote } from './ui/tela-pacotes';
export { TelaCorrespondencia } from './ui/tela-correspondencia';
export { TelaMetas, textoAvisoMeta, type FormularioMetaAberto, type PermissoesMeta } from './ui/tela-metas';
export { TelaEmpregados, textoAvisoEmpregado, type FinalizacaoPessoal, type FormularioPessoalAberto, type PermissoesPessoal } from './ui/tela-empregados';
export { TelaQtdeEmpregados, textoAvisoQtde } from './ui/tela-qtde-empregados';
export { TelaCronograma } from './ui/tela-cronograma';
export { TelaRealizado } from './ui/tela-realizado';
export { TelaOxr } from './ui/tela-oxr';
export { TelaPrevisao } from './ui/tela-previsao';
export { TelaRateio, textoAvisoRateio, type AcoesRateio, type PermissoesRateio } from './ui/tela-rateio';
export { TelaTotalizadores } from './ui/tela-totalizadores';
export { TelaBens, textoAvisoBem, type FormularioBemAberto } from './ui/tela-bens';
export { obterPreVisualizacao, type PreVisualizacao } from './application/pre-visualizacao';
export { TelaPreVisualizacao } from './ui/tela-pre-visualizacao';
export { obterComparativoTps, obterConsolidado, type ComparativoTp, type Consolidado } from './application/consolidado';
export { TelaConsolidado } from './ui/tela-consolidado';
export { TelaViagens, textoAvisoViagem, type AcoesViagens, type FormularioViagemAberto, type ValidacaoViagens } from './ui/tela-viagens';
export { TelaPropostas, textoAvisoProposta } from './ui/tela-propostas';
export { TelaPosicoes, textoAvisoPosicao } from './ui/tela-posicoes';
export { AcoesCiclo } from './ui/acoes-ciclo';
export { PainelRevisao } from './ui/painel-revisao';
export { FormExercicio } from './ui/form-exercicio';
export { FormImportacao } from './ui/form-importacao';
export { ListaExercicios, textoAviso } from './ui/lista-exercicios';
export { ListaReceitas, SELO_TRANSICAO, textoAvisoReceita } from './ui/lista-receitas';
export { exercicioDoAno, naoEncontradoSeNegado } from './ui/pagina';
export { SeletorExercicio, type OpcaoExercicio } from './ui/seletor-exercicio';
export { VisaoCc } from './ui/visao-cc';
