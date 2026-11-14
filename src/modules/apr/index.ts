// Entrada pública do apr (Aprovações: solicitações e Central de Tarefas; US-078, plano do P26).
export {
  criarSolicitacao,
  decidirSolicitacao,
  listarTarefas,
  obterTarefa,
  pendenteDoAlvo,
  type DadosSolicitacao,
  type DepsApr,
  type FiltrosTarefas,
  type ItemResumo,
  type Manipulador,
  type Manipuladores,
  type SolicitacaoDecidivel,
  type TarefaTela,
} from './application/solicitacoes';
export { MENSAGENS_APR, ROTULO_SITUACAO_SOLICITACAO, SITUACOES_SOLICITACAO, validarJustificativa, type SituacaoSolicitacao } from './domain/solicitacao';
export { FUNCIONALIDADES_APR, seedApr } from './infrastructure/seed';
export { SeloSituacao, TelaTarefas, textoAvisoTarefa } from './ui/tela-tarefas';
