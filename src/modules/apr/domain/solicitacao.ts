import { falha, ok, type Resultado } from '@/shared/kernel';

// Solicitação de aprovação (US-078; Aprovações V2, UC6.00 a UC6.02; plano do P26, D-P26-5). Funções puras: o
// roteamento (alçada) e o efeito no alvo (manipulador do fluxo) ficam fora.

export const SITUACOES_SOLICITACAO = ['EM_APROVACAO', 'APROVADO', 'REJEITADO'] as const;
export type SituacaoSolicitacao = (typeof SITUACOES_SOLICITACAO)[number];
export const ROTULO_SITUACAO_SOLICITACAO: Readonly<Record<SituacaoSolicitacao, string>> = {
  EM_APROVACAO: 'Em Aprovação',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
};

export const JUSTIFICATIVA_MINIMA = 15;
export const LIMITE_JUSTIFICATIVA = 2000;

export const MENSAGENS_APR = {
  JUSTIFICATIVA_CURTA: `Justificativa obrigatória: descreva o motivo da recusa com pelo menos ${JUSTIFICATIVA_MINIMA} caracteres.`,
  JUSTIFICATIVA_GENERICA: 'Justificativa genérica: descreva o motivo real da recusa, sem repetir um caractere ou uma palavra.',
  JUSTIFICATIVA_LONGA: `A justificativa pode ter no máximo ${LIMITE_JUSTIFICATIVA} caracteres.`,
  CONCORRENTE: 'Operação Rejeitada [TRAVA O ERRO]: Este Termo de Parceria já foi homologado ou rejeitado por outro aprovador. Recarregue a Central de Tarefas.',
  INEXISTENTE: 'Solicitação não encontrada na sua Central de Tarefas.',
  NAO_E_APROVADOR: 'Esta solicitação foi roteada para outro aprovador.',
  SEM_MANIPULADOR: 'Este fluxo ainda não pode ser decidido por esta tela.',
  DADOS_INVALIDOS: 'Dados da decisão inválidos. Recarregue a tela.',
  APROVADA: (descricao: string) => `Solicitação "${descricao}" aprovada.`,
  REJEITADA: (descricao: string) => `Solicitação "${descricao}" rejeitada.`,
  CONFIRMA_APROVAR: 'Confirma a aprovação desta solicitação? A decisão não poderá ser desfeita.',
} as const;

/**
 * RN_WA01_006 (D-P26-5) [PROVISÓRIO na leitura de "padrões genéricos repetitivos"]: ao menos 15 caracteres, e não
 * só a repetição de um caractere ("aaaaaaaaaaaaaaa") ou de uma palavra ("teste teste teste").
 */
export function validarJustificativa(texto: unknown): Resultado<string> {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if ([...t].length < JUSTIFICATIVA_MINIMA) return falha([{ campo: 'justificativa', mensagem: MENSAGENS_APR.JUSTIFICATIVA_CURTA }]);
  if ([...t].length > LIMITE_JUSTIFICATIVA) return falha([{ campo: 'justificativa', mensagem: MENSAGENS_APR.JUSTIFICATIVA_LONGA }]);
  const semEspaco = t.replace(/\s+/g, '').toLocaleLowerCase('pt-BR');
  const palavras = t
    .toLocaleLowerCase('pt-BR')
    .split(/[\s.,;:!?]+/)
    .filter(Boolean);
  if (new Set(semEspaco).size <= 1 || new Set(palavras).size <= 1) return falha([{ campo: 'justificativa', mensagem: MENSAGENS_APR.JUSTIFICATIVA_GENERICA }]);
  return ok(t);
}
