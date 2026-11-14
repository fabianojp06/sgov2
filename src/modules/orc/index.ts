// Entrada pública do orc (orçamento da Administração Central, UC04.17).
export { avancar, criar } from './application/acoes-exercicios';
export { aprovarAcao, enviarAcao, pedirRevisaoAcao, rejeitarAcao } from './application/acoes-aprovacao';
export { importarPlanilhaAcao } from './application/acoes-importacao';
export { definirTetoAcao, recalcularAcao } from './application/acoes-orcamento';
export { alterarPacoteAcao, excluirPacoteAcao, incluirPacoteAcao } from './application/acoes-pacotes';
export { sugerirContaCcAcao, sugerirJustificativaAcao } from './application/acoes-ia';
export { CASOS_IA_ORC } from './application/ia-casos';
export { iaLiberada } from './application/ia-deps';
export { alterarPosicaoAcao, excluirPosicaoAcao, incluirPosicaoAcao, ligarCargoAcao, previaPosicaoAcao } from './application/acoes-posicoes';
export { alterarMetaAcao, excluirMetaAcao, incluirMetaAcao } from './application/acoes-metas';
export {
  alterarEmpregadoAcao,
  alterarQtdeAcao,
  excluirEmpregadoAcao,
  excluirQtdeAcao,
  incluirEmpregadoAcao,
  incluirQtdeAcao,
} from './application/acoes-empregados';
export { alterarBemAcao, excluirBemAcao, incluirBemAcao } from './application/acoes-bens';
export { alterarTetoAcao, alterarViagemAcao, excluirTetoAcao, excluirViagemAcao, incluirTetoAcao, incluirViagemAcao } from './application/acoes-viagens';
export { criarPropostaAcao, duplicarPropostaAcao, excluirPropostaAcao, novaVersaoPropostaAcao } from './application/acoes-propostas';
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
  type BlocoEmpregados,
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
export { TelaEmpregados, textoAvisoEmpregado, type FormularioPessoalAberto, type PermissoesPessoal } from './ui/tela-empregados';
export { TelaQtdeEmpregados, textoAvisoQtde } from './ui/tela-qtde-empregados';
export { TelaTotalizadores } from './ui/tela-totalizadores';
export { TelaBens, textoAvisoBem, type FormularioBemAberto } from './ui/tela-bens';
export { TelaViagens, textoAvisoViagem, type AcoesViagens, type FormularioViagemAberto } from './ui/tela-viagens';
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
