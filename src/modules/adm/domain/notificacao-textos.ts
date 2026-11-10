// Textos e constantes das notificações de desempenho (US-041) sem nenhum import: a tela cliente os
// usa, e o bundle do navegador não pode levar o kernel (decimal.js etc.). A mensagem de conflito
// (MENSAGEM_CONFLITO, do kernel) fica só no servidor.

/** Valor do select para a opção "Todas" (RN0051); gravado como conta nula. */
export const CONTA_TODAS = '*';
export const ROTULO_TODAS = 'Todas';

// O A2 e o A3 do UC02.20 pedem as mensagens sem dar o texto: todas [PROVISÓRIAS] (D-P10-9).
export const MENSAGENS_NOTIFICACAO = {
  CONTA: 'Selecione a conta sintética.',
  CONTA_INVALIDA: 'Selecione uma conta sintética ativa ou a opção Todas.',
  CONTA_INEXISTENTE: 'Conta inexistente ou inativa',
  LIMITE: 'Informe o limite em % do orçado: maior que zero, até 999,99 e com no máximo duas casas decimais.',
  FREQUENCIA: 'Informe a frequência em dias: um número inteiro de 1 a 365.',
  USUARIO: 'O usuário é obrigatório.',
  USUARIO_INATIVO: 'Selecione um usuário ativo cadastrado no sistema.',
  DUPLICADA: 'Este usuário já recebe a notificação desta conta.',
  INATIVA: 'Esta notificação já foi excluída.',
  INEXISTENTE: 'Notificação não encontrada',
  CONFIRMAR_EXCLUSAO: 'Deseja realmente excluir esta notificação?',
} as const;
