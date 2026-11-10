import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm';
import type { Seed } from '@/shared/db';

const GRUPO = 'Orçamento da Adm. Central';

// Funcionalidades do orc (contrato C6), no menu Administração Central (§6.7). Perfis padrão
// [PROVISÓRIOS] até o GAP-ORC-004 (D-P6-4 do plano do P6); a importação é só da GFIN (D-P6-6).
export const FUNCIONALIDADES_ORC: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'orc.orcamento',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Orçamento da Adm. Central',
    rota: '/orc/orcamento',
    ordem: 1,
    ajuda: 'Visão do orçamento do exercício por centro de custo, com a série mês a mês, o teto, o semáforo e o resultado.',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: { GFIN: ['consultar', 'alterar'], DIREX: ['consultar'], AUDITOR: ['consultar'], GESTOR_DIRETORIA: ['consultar'] },
  },
  {
    codigo: 'orc.exercicios',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Exercícios',
    rota: '/orc/exercicios',
    ordem: 2,
    ajuda: 'Cria o exercício do ano, em branco ou copiando o anterior, e avança o Rascunho para Em Elaboração.',
    acoes: ['consultar', 'incluir', 'alterar'],
    perfisPadrao: { GFIN: ['consultar', 'incluir', 'alterar'], DIREX: ['consultar'], AUDITOR: ['consultar'] },
  },
  {
    codigo: 'orc.importacao',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Importar planilha',
    rota: '/orc/importacao',
    ordem: 3,
    ajuda: 'Importa a planilha-modelo do exercício (layout ADMC-ORC v1.0), com o relatório de erros por linha.',
    acoes: ['consultar', 'executar'],
    perfisPadrao: { GFIN: ['consultar', 'executar'] },
  },
  {
    codigo: 'orc.receitas',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Receitas – Rateio dos TPs',
    rota: '/orc/receitas',
    ordem: 4,
    ajuda: 'Rateio de cada TP no exercício, confirmado ou previsto, digitado pela GFIN na transição.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: { GFIN: ['consultar', 'incluir', 'alterar', 'excluir'], DIREX: ['consultar'], AUDITOR: ['consultar'] },
  },
  {
    // D-P12-2 [PROVISÓRIO]: como os pacotes; o salário só para quem inclui ou altera (D-P12-3).
    codigo: 'orc.posicoes',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Posições de pessoal',
    rota: '/orc/posicoes',
    ordem: 5,
    ajuda: 'Lança, altera e exclui as posições de pessoal do orçamento por centro de custo, com a prévia do custo (massa, férias e 13º, encargos, benefícios e anual).',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      GESTOR_DIRETORIA: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar', 'incluir', 'alterar', 'excluir'],
      DIREX: ['consultar'],
      AUDITOR: ['consultar'],
    },
  },
  {
    // D-P11-1 [PROVISÓRIO]: o Gestor de Diretoria lança nos CCs do escopo; a GFIN, em qualquer CC.
    codigo: 'orc.pacotes',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Pacotes base zero',
    rota: '/orc/pacotes',
    ordem: 6,
    ajuda: 'Lança, altera e exclui os pacotes base zero do orçamento por centro de custo, com a prévia do anual e das 12 parcelas.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      GESTOR_DIRETORIA: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar', 'incluir', 'alterar', 'excluir'],
      DIREX: ['consultar'],
      AUDITOR: ['consultar'],
    },
  },
  {
    codigo: 'orc.aprovacao',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'Envio e aprovação',
    rota: '/orc/aprovacao',
    ordem: 7,
    ajuda: 'A GFIN envia o orçamento para aprovação; a Diretoria Executiva aprova, e oficializa, ou rejeita com justificativa.',
    acoes: ['consultar', 'executar', 'aprovar'],
    perfisPadrao: { GFIN: ['consultar', 'executar'], DIREX: ['consultar', 'aprovar'], AUDITOR: ['consultar'] },
  },
];

export const seedOrc: Seed = {
  nome: 'orc',
  executar: async (tx) => {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_ORC);
  },
};
