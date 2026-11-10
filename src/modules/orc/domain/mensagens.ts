import { MENSAGEM_CONFLITO } from '@/shared/kernel';

// Mensagens do orçamento da Adm. Central [PROVISÓRIAS]: o UC04.17 ainda não é EP (GAP-ORC-004).
// Textos das Global Constraints do plano do P6; cada tarefa acrescenta os que usa, e os com
// parâmetro viram função.
export const MENSAGENS_ORC = {
  EXERCICIO_DUPLICADO: (ano: number) => `Já existe um exercício para o ano ${ano}.`,
  ANO_INVALIDO: 'Informe um ano entre 2000 e 2099.',
  SEM_EXERCICIO_ANTERIOR: 'Não há exercício anterior para copiar.',
  SITUACAO_NAO_EDITAVEL: (situacao: string) => `Este exercício não pode ser alterado na situação ${situacao}.`,
  PREMISSAS_DESATUALIZADAS: 'As premissas do exercício mudaram depois do último cálculo. Recalcule o orçamento.',
  PREMISSAS_DESATUALIZADAS_ESCOPO: 'As premissas do exercício mudaram depois do último cálculo. Peça à GFIN para recalcular o orçamento antes de importar.',
  RECALCULO_FORA_DO_ESCOPO: 'Há posições de outros centros de custo que não puderam ser calculadas. Avise a GFIN.',
  PREMISSAS_MUDARAM_NA_APROVACAO: 'As premissas do exercício mudaram durante a aprovação. Tente novamente.',
  RECALCULADO: 'O orçamento foi recalculado.',
  FORA_DO_ESCOPO_TOTAL: 'Esta operação é só para quem vê toda a Adm. Central.',
  RECEITAS_SO_ESCOPO_TOTAL: 'Receitas só podem ser importadas por quem vê toda a Adm. Central.',
  ALTERADO_POR_OUTRO: MENSAGEM_CONFLITO,
  // Planilha (Task 4a)
  CC_OBRIGATORIO: 'CC analítico obrigatório.',
  CC_NAO_ANALITICO: 'CC não é analítico ativo.',
  CC_FORA_DO_ESCOPO: 'CC fora do seu escopo.',
  CONTA_NAO_PERMITIDA: 'Conta não permitida em pacote base zero.',
  CARGO_OBRIGATORIO: 'Cargo obrigatório.',
  QUANTIDADE: (maximo: string) => `Quantidade inteira, de 1 a ${maximo}.`,
  SALARIO_ZERO: 'Salário maior que zero.',
  SALARIO_LIMITE: 'Salário mensal precisa ser menor que R$ 1.000.000,00.',
  MES_INVALIDO: 'Informe um mês de 1 a 12.',
  INICIO_DEPOIS_DA_SAIDA: 'Mês de início depois do mês de saída.',
  JUSTIFICATIVA_CURTA: 'Justificativa com menos de 10 caracteres.',
  PRIORIDADE: 'Prioridade obrigatória: Essencial, Importante ou Desejável.',
  IPCA: 'Informe Sim ou Não em Corrigir pelo IPCA.',
  DISTRIBUICAO: 'Distribuição obrigatória: Mensal ou Pontual.',
  VALOR_UNITARIO_ZERO: 'Valor unitário maior que zero.',
  VALOR_UNITARIO_LIMITE: 'Valor unitário precisa ser menor que R$ 100.000.000,00.',
  MES_RECEITA_LIMITE: 'Valor do mês precisa ser menor que R$ 100.000.000.000,00.',
  VALOR_FORMATO: 'Valor em formato inválido. Digite o número na célula, com até 2 casas decimais.',
  TEXTO_FORMULA: 'Texto não pode começar com =, + ou @.',
  TP_OBRIGATORIO: 'TP / versão obrigatório.',
  SITUACAO_RECEITA: 'Situação obrigatória: Confirmado ou Previsto.',
  TP_REPETIDO: (linhas: readonly number[]) => `TP / versão repetido nas linhas ${linhas.slice(0, -1).join(', ')} e ${linhas.at(-1)}.`,
  MES_NEGATIVO: 'Valor do mês não pode ser negativo.',
  // Envio e aprovação (Task 8)
  EXERCICIO_VAZIO: 'O orçamento não tem lançamentos para enviar.',
  LANCAMENTO_INATIVO: (cc: string, conta: string) => `CC ${cc} ou conta ${conta} não é mais analítico ativo: reimporte a planilha ou corrija o pacote na tela antes de enviar.`,
  QUEM_ENVIOU_NAO_APROVA: 'Quem enviou o orçamento para aprovação não pode aprová-lo.',
  REJEICAO_CURTA: 'A justificativa da rejeição precisa ter pelo menos 15 caracteres.',
  CONFIRMA_ENVIO: (ano: number) => `Deseja realmente enviar o orçamento ${ano} para aprovação?`,
  CONFIRMA_APROVACAO: (ano: number) => `Deseja realmente aprovar e oficializar o orçamento ${ano}?`,
  // Teto e resultado (Task 7)
  TETO_ZERO: 'O teto precisa ser maior que zero.',
  TETO_JUSTIFICATIVA: 'Teto maior que a receita confirmada exige justificativa com pelo menos 15 caracteres.',
  SEM_TETO: 'Sem teto: não há receita confirmada nem teto manual.',
  SEMAFORO_SEM_PERMISSAO: 'Sem permissão para ver as faixas do semáforo.',
  SEMAFORO_INDISPONIVEL: 'As faixas do semáforo ainda não estão disponíveis.',
  TETO_DEFINIDO: 'Teto do exercício gravado.',
  TETO_SEM_JUSTIFICATIVA: 'O teto manual passou da receita confirmada e não tem justificativa: grave o teto de novo com a justificativa (o envio para aprovação é recusado até lá).',
  // Visão (Task 6)
  PREMISSAS_INEXISTENTES: 'O exercício ainda não tem premissas cadastradas.',
  PREMISSAS_INDISPONIVEIS: 'As premissas do exercício ainda não estão disponíveis.',
  SEM_EXERCICIO: 'Nenhum exercício cadastrado.',
  CC_DESCONHECIDO: '(CC fora da estrutura)',
  // Importação (Task 4b)
  PLANILHA_COM_ERROS: 'A planilha tem erros. Nada foi importado.',
  PLANILHA_VAZIA: 'A planilha não tem lançamentos.',
  // [PROVISÓRIO] (R6, #279): a aba Instruções sem a versão do layout em E1.
  VERSAO_LAYOUT: 'Planilha fora do layout ADMC-ORC v1.0: a célula E1 da aba Instruções precisa trazer ADMC-ORC v1.0.',
  FORA_DO_LAYOUT: (aba: string, colunas: readonly string[]) =>
    `Planilha fora do layout ADMC-ORC v1.0: a aba ${aba} precisa do cabeçalho, até a linha 4, com as colunas ${colunas.join(', ')}.`,
  MAIS_ERROS: (n: number) => `E mais ${n} erro(s) não listados. Corrija os acima e importe de novo.`,
  TP_DATA: 'O Excel converteu o TP / versão em data: formate a célula como texto e digite de novo.',
  ARQUIVO_GRANDE: 'Arquivo maior que 1 MB.',
  IMPORTADA: (posicoes: number, pacotes: number, ccs: number, receitas: number) =>
    `Planilha importada: ${posicoes} posições e ${pacotes} pacotes em ${ccs} CCs, ${receitas} receitas.`,
  // Receitas (Task 5)
  RECEITA_DUPLICADA: (tp: string) => `Já existe receita do TP ${tp} neste exercício.`,
  RECEITA_INEXISTENTE: 'Receita não encontrada.',
  SELO_TRANSICAO: 'Digitado na transição',
  // Pacotes base zero pela tela (US-057; plano do P11) [PROVISÓRIOS]
  PREMISSAS_DESATUALIZADAS_PACOTE: 'As premissas do exercício mudaram. Peça à GFIN para recalcular o orçamento antes de lançar.',
  PACOTE_DA_PLANILHA: 'Este pacote veio da planilha: uma nova importação deste CC o substitui.',
  PACOTE_DA_COPIA: 'Este pacote veio da cópia do exercício anterior: uma nova importação deste CC o substitui.',
  CONTA_PACOTE_FORA_DAS_OPCOES: (conta: string) => `A conta ${conta} não é mais permitida em pacote; escolha outra.`,
  CC_PACOTE_FORA_DAS_OPCOES: (cc: string) => `O CC ${cc} não está mais disponível para pacote; escolha outro.`,
  PACOTE_INEXISTENTE: 'Pacote não encontrado.',
  RECALCULO_BARROU_PACOTE: 'O pacote não foi gravado: o recálculo do orçamento encontrou erro em outro lançamento do exercício.',
  PACOTES_DA_TELA_MANTIDOS: (cc: string, n: number) => `O CC ${cc} mantém ${n} pacote(s) lançado(s) pela tela.`,
  CONFIRMA_EXCLUSAO_PACOTE: (conta: string, cc: string) => `Deseja realmente excluir o pacote da conta ${conta} do CC ${cc}?`,
} as const;
