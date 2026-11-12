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
  // Posições de pessoal pela tela (US-056; plano do P12) [PROVISÓRIOS]. Premissas mudadas: a mesma
  // PREMISSAS_DESATUALIZADAS_PACOTE (D-P12-5), que não cita o pacote.
  POSICAO_DA_IMPORTACAO: 'Esta posição não foi lançada pela tela: uma nova importação deste CC a substitui.',
  CC_POSICAO_FORA_DAS_OPCOES: (cc: string) => `O CC ${cc} não está mais disponível para posição; escolha outro.`,
  POSICAO_INEXISTENTE: 'Posição não encontrada.',
  RECALCULO_BARROU_POSICAO: 'A posição não foi gravada: o recálculo do orçamento encontrou erro em outro lançamento do exercício.',
  POSICOES_DA_TELA_MANTIDAS: (cc: string, n: number) => `O CC ${cc} mantém ${n} posição(ões) lançada(s) pela tela.`,
  CONFIRMA_EXCLUSAO_POSICAO: (cargo: string, cc: string) => `Deseja realmente excluir a posição ${cargo} do CC ${cc}?`,
  PREVIA_POSICAO_INCOMPLETA: 'Preencha a quantidade, o salário mensal e os meses de início e de saída para ver a prévia.',
  // Cargo do cadastro de C&S na posição (US-056; plano do P15, D-P15-1 a D-P15-6) [PROVISÓRIOS]. Nenhum
  // cita salário, Fonte Ativa nem faixa.
  CARGO_INATIVO: 'Este cargo está inativo. Escolha outro.',
  CARGO_SEM_FONTE_ATIVA: 'Este cargo está sem salário na Fonte Ativa. Escolha outro ou peça ao GRH para completar o cadastro.',
  CARGO_NAO_ENCONTRADO: 'Cargo não encontrado no cadastro.',
  CARGO_NAO_ESCOLHIDO: 'Escolha o cargo do cadastro ou informe o cargo em texto.',
  CARGO_ESCOLHA: 'Escolha o cargo',
  CARGO_FORA_DO_CADASTRO: 'o cargo não está mais no cadastro.',
  SEM_CARGO_DO_CADASTRO: 'Não há cargo do cadastro disponível; informe o cargo em texto.',
  FONTE_ATIVA_INDISPONIVEL: 'O salário da Fonte Ativa está indisponível no momento. Informe o salário mensal.',
  FONTE_ATIVA_SEM_PERFIL: 'O salário da Fonte Ativa não aparece para o seu perfil. Informe o salário mensal.',
  CARGO_INATIVO_ROTULO: '(inativo)',
  CARGO_TEXTO_LIVRE: 'Outro cargo (texto livre)',
  CARGO_MANTER_TEXTO: (cargo: string) => `Manter o cargo em texto: ${cargo}`,
  // Tela de correspondência do cargo em texto com o cadastro (US-056; plano do P16) [PROVISÓRIOS].
  CORRESPONDENCIA_SEM_POSICOES: 'Nenhuma posição com esse cargo em texto. Recarregue a tela.',
  CORRESPONDENCIA_VAZIA: 'Nenhuma posição com cargo em texto neste exercício.',
  CORRESPONDENCIA_LIGADA: (n: number) => (n === 1 ? '1 posição ligada ao cargo do cadastro.' : `${n} posições ligadas ao cargo do cadastro.`),
  CORRESPONDENCIA_ERRO_POSICAO: (cc: string, mensagem: string) => `CC ${cc}: ${mensagem}`,
  CORRESPONDENCIA_LINK: 'Ligar cargos em texto ao cadastro',
  CONFIRMA_LIGAR_CARGO: (texto: string, n: number, nome: string) =>
    `Ligar ${n === 1 ? 'a posição' : `as ${n} posições`} com o cargo "${texto}" ao cargo ${nome} do cadastro? O salário gravado não muda.`,
  POSICOES_COM_CARGO_SUBSTITUIDAS: (n: number) =>
    n === 1
      ? '1 posição ligada a cargo do cadastro foi substituída por esta importação.'
      : `${n} posições ligadas a cargo do cadastro foram substituídas por esta importação.`,
  // Ajuda da IA (US-063; plano do P14) [PROVISÓRIOS]. O selo é o da spec §6.8 (princípio 3).
  SELO_IA: 'Gerado com IA – revisar',
  IA_CONSULTANDO: 'Consultando a IA…',
  IA_TEMPO_ESGOTADO: 'A IA demorou demais para responder. Tente de novo.',
  IA_SEM_NOMES: 'Não escreva nomes de pessoas no texto enviado à IA.',
  IA_FALHA_CONSULTA: 'Não foi possível consultar a IA. Tente de novo.',
  // Sugestão de conta e CC (US-062; D-P14-2) [PROVISÓRIOS].
  IA_DESCRICAO_CURTA: 'Descreva o gasto com pelo menos 10 caracteres.',
  IA_SEM_SUGESTAO_VALIDA: 'A IA não encontrou uma sugestão válida. Escolha a conta na lista.',
  IA_SUGESTAO_CONTA_AVISO: 'A IA lê o texto do campo Atividade / justificativa como a descrição do gasto. Não escreva nomes de pessoas no texto enviado à IA.',
  // Revisor antes do envio (US-064; D-P14-6, D-P14-7 e D-P14-8) [PROVISÓRIOS].
  REVISAO_SO_EM_ELABORACAO: 'A revisão é só para o orçamento Em Elaboração.',
  REVISAO_PEDIDA: 'Revisão pedida. Os achados aparecem aqui quando ela terminar.',
  REVISAO_EM_ANDAMENTO: 'Revisão em andamento…',
  REVISAO_FALHOU: 'A revisão falhou.',
  REVISAO_CONCLUIDA: (n: number) => (n === 1 ? 'Revisão concluída com 1 achado.' : `Revisão concluída com ${n} achados.`),
  REVISAO_NENHUMA: 'Nenhuma revisão pedida para este exercício.',
  REVISAO_SEM_ACHADOS: 'Nenhum achado.',
  REVISAO_PARADA: 'A revisão não terminou. Peça de novo.',
  REVISAO_DESATUALIZADA: 'O orçamento mudou depois desta revisão. Revise de novo.',
  REVISAO_IA_DESLIGADA: 'A parte da IA está desligada; estes são só os achados automáticos.',
  REVISAO_SEM_ACESSO: 'Quem pediu a revisão não está mais com acesso; estes são só os achados automáticos.',
  REVISAO_GRANDE: 'O orçamento é grande demais para a revisão da IA; estes são só os achados automáticos.',
  REVISAO_ERRO_IA: (mensagem: string) => `${mensagem} Estes são só os achados automáticos.`,
  REVISAO_SEM_ANTERIOR: (ano: number) => `Não há orçamento oficializado de ${ano}; a comparação com o ano anterior não foi feita.`,
  REVISAO_SEM_PACOTES: 'Sem permissão para consultar os pacotes base zero, a IA não leu os pacotes nem os totais.',
  REVISAO_SEM_POSICOES: 'Sem permissão para consultar as posições de pessoal, a IA não leu as posições.',
  // Regras de pessoal do revisor (plano do P15, D-P15-4) [PROVISÓRIOS].
  REVISAO_SEM_PREMISSAS: (ano: number) => `O exercício ${ano} não tem premissas; a regra de benefícios não rodou.`,
  REVISAO_SEM_CARGO: (n: number) =>
    n === 1
      ? '1 posição sem cargo do cadastro ficou fora das regras de benefício e de faixa salarial.'
      : `${n} posições sem cargo do cadastro ficaram fora das regras de benefício e de faixa salarial.`,
  REVISAO_CARGO_FORA_DO_CADASTRO: (n: number) =>
    n === 1
      ? '1 posição ligada a cargo que não está mais no cadastro ficou fora das regras de pessoal.'
      : `${n} posições ligadas a cargo que não está mais no cadastro ficaram fora das regras de pessoal.`,
} as const;
