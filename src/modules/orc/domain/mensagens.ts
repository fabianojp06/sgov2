// Mensagens do orçamento da Adm. Central [PROVISÓRIAS]: o UC04.17 ainda não é EP (GAP-ORC-004).
// Textos das Global Constraints do plano do P6; cada tarefa acrescenta os que usa, e os com
// parâmetro viram função.
export const MENSAGENS_ORC = {
  EXERCICIO_DUPLICADO: (ano: number) => `Já existe um exercício para o ano ${ano}.`,
  ANO_INVALIDO: 'Informe um ano entre 2000 e 2099.',
  SEM_EXERCICIO_ANTERIOR: 'Não há exercício anterior para copiar.',
  SITUACAO_NAO_EDITAVEL: (situacao: string) => `Este exercício não pode ser alterado na situação ${situacao}.`,
  PREMISSAS_DESATUALIZADAS: 'As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.',
  PREMISSAS_MUDARAM_NA_APROVACAO: 'As premissas do exercício mudaram durante a aprovação. Tente novamente.',
  RECALCULADO: 'O orçamento foi recalculado.',
  FORA_DO_ESCOPO_TOTAL: 'Esta operação é só para quem vê toda a Adm. Central.',
  RECEITAS_SO_ESCOPO_TOTAL: 'Receitas só podem ser importadas por quem vê toda a Adm. Central.',
  ALTERADO_POR_OUTRO: 'Este registro foi alterado por outro usuário. Recarregue a tela.',
} as const;
