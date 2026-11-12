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
export { criarPropostaAcao, excluirPropostaAcao } from './application/acoes-propostas';
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
export { ccsLivresParaTp, listarPropostas, type CcLivreTp, type PropostaTela } from './application/propostas';
export { listarReceitas, obterReceita, type ListaReceitas as DadosReceitas } from './application/receitas';
export { mascararHistoricoOrc, type HistoricoMascaradoOrc } from './domain/mascara-historico';
export { MENSAGENS_ORC } from './domain/mensagens';
export { FUNCIONALIDADES_ORC, seedOrc } from './infrastructure/seed';
export { FormReceita, type ReceitaFormulario } from './ui/form-receita';
export { TelaPacotes, textoAvisoPacote } from './ui/tela-pacotes';
export { TelaCorrespondencia } from './ui/tela-correspondencia';
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
