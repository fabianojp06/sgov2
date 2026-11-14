import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm';
import type { Seed } from '@/shared/db';
import { instalarCasosUsoIA } from '@/shared/ia';
import { CASOS_IA_ORC } from '../application/ia-casos';

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
  // Casos de IA (plano do P14, D-P14-1) [PROVISÓRIOS]: só a permissão do caso, fora do menu. O caso
  // nasce desligado; o Administrador liga e define o teto no cadastro da IA (US-019).
  {
    codigo: 'orc.ia_justificativa',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'IA: ajuda na justificativa',
    rota: '/orc/pacotes',
    ordem: 8,
    ajuda: 'Pede à IA uma redação melhor para a justificativa do pacote base zero, o que falta nela e a prioridade sugerida. A IA só sugere; quem salva é a pessoa.',
    exibirNoMenu: false,
    acoes: ['executar'],
    perfisPadrao: { GESTOR_DIRETORIA: ['executar'], GFIN: ['executar'] },
  },
  {
    codigo: 'orc.ia_sugestao_conta',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'IA: sugestão de conta e CC',
    rota: '/orc/pacotes',
    ordem: 9,
    ajuda: 'Pede à IA a conta e o centro de custo do pacote base zero a partir da descrição do gasto. A IA só sugere; quem escolhe é a pessoa.',
    exibirNoMenu: false,
    acoes: ['executar'],
    // ADMINISTRADOR (#403): é quem pede "Avaliar a qualidade" na /int/ia, e o avaliador roda em nome dele
    // com esta permissão. Não abre o formulário de pacotes, que também exige orc.pacotes.
    perfisPadrao: { GESTOR_DIRETORIA: ['executar'], GFIN: ['executar'], ADMINISTRADOR: ['executar'] },
  },
  {
    codigo: 'orc.ia_revisor',
    modulo: 'ADM_CENTRAL',
    grupo: GRUPO,
    nome: 'IA: revisor antes do envio',
    rota: '/orc/aprovacao',
    ordem: 10,
    ajuda: 'Acrescenta à revisão antes do envio os achados da IA sobre justificativas, contas e lançamentos duplicados. A IA só aponta; nada é alterado.',
    exibirNoMenu: false,
    acoes: ['executar'],
    perfisPadrao: { GFIN: ['executar'] },
  },
  {
    // Proposta de TP (US-065; plano do P17, D-P17-9) [PROVISÓRIO]: no menu Cadastros › Propostas (§6.7),
    // com o código no orc (D-P17-1). O Orçamentista escreve; GFIN, Auditor e DIREX leem (§11.3). Cada um
    // vê só as propostas dos TPs a que está vinculado (RLS, US-007).
    codigo: 'orc.propostas',
    modulo: 'CADASTROS',
    grupo: 'Propostas',
    nome: 'Propostas',
    rota: '/orc/propostas',
    ordem: 1,
    ajuda: 'Cria a proposta de TP (capa, categoria, vigência e centro de custo próprio), que nasce na Versão 1 em Rascunho, lista as propostas dos seus TPs e exclui a que ainda está em Rascunho.',
    acoes: ['consultar', 'incluir', 'excluir'],
    perfisPadrao: {
      ORCAMENTISTA: ['consultar', 'incluir', 'excluir'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    // Metas da proposta (US-067; plano do P19, D-P19-8) [PROVISÓRIO]: no menu Cadastros › Metas (UC03.14),
    // com a matriz de orc.propostas. Cada um vê só as metas dos TPs a que está vinculado (RLS).
    codigo: 'orc.metas',
    modulo: 'CADASTROS',
    grupo: 'Propostas',
    nome: 'Metas',
    rota: '/orc/metas',
    ordem: 2,
    ajuda: 'Cadastra, altera e exclui as metas da última versão das propostas de categoria Meta, em Rascunho ou Em Elaboração, e mostra o total das metas e o saldo a distribuir.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      ORCAMENTISTA: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    // Empregados da proposta (US-070; plano do P20, D-P20-10) [PROVISÓRIO]: no menu Cadastros › Empregados
    // (UC03.24). Orçamentista e Analista GRH lançam (§11.3: o GRH tem os Empregados e parte o WA05); GFIN,
    // Auditor e DIREX leem, sem o custo (D-P20-5). Cada um vê só os TPs a que está vinculado (RLS).
    codigo: 'orc.empregados',
    modulo: 'CADASTROS',
    grupo: 'Propostas',
    nome: 'Empregados',
    rota: '/orc/empregados',
    ordem: 3,
    ajuda: 'Lança os empregados e as vagas "A CONTRATAR" da última versão das propostas, por meta, cargo e competência, com o custo pelo motor de pessoal.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      ORCAMENTISTA: ['consultar', 'incluir', 'alterar', 'excluir'],
      ANALISTA_GRH: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    // Quantitativos de pessoal por período (US-070; plano do P20, D-P20-6 e D-P20-10) [PROVISÓRIO]: no menu
    // Cadastros › Qtde. Empregados (UC03.20), com a matriz de orc.empregados.
    codigo: 'orc.qtde_empregados',
    modulo: 'CADASTROS',
    grupo: 'Propostas',
    nome: 'Qtde. Empregados',
    rota: '/orc/qtde-empregados',
    ordem: 4,
    ajuda: 'Registra os períodos de vigência com o documento de respaldo e mostra, contadas dos empregados, as quantidades de empregados, estagiários e jovens aprendizes.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      ORCAMENTISTA: ['consultar', 'incluir', 'alterar', 'excluir'],
      ANALISTA_GRH: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    // Viagens da proposta (US-071; plano do P21, D-P21-10) [PROVISÓRIO]: no menu Cadastros › Viagens (spec 7,
    // Viagens V3). Orçamentista e Operador de Viagens lançam os tetos e as viagens (§11.3: "aba Viagens das
    // propostas"); GFIN, Auditor e DIREX leem. Cada um vê só os TPs a que está vinculado (RLS).
    codigo: 'orc.viagens',
    modulo: 'CADASTROS',
    grupo: 'Propostas',
    nome: 'Viagens',
    rota: '/orc/viagens',
    ordem: 5,
    ajuda: 'Planeja as viagens da última versão das propostas, com o teto por conta sintética, o custo de passagens e diárias e o painel de indicadores.',
    acoes: ['consultar', 'incluir', 'alterar', 'excluir'],
    perfisPadrao: {
      ORCAMENTISTA: ['consultar', 'incluir', 'alterar', 'excluir'],
      OPERADOR_VIAGENS: ['consultar', 'incluir', 'alterar', 'excluir'],
      GFIN: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
];

export const seedOrc: Seed = {
  nome: 'orc',
  executar: async (tx) => {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_ORC);
    // Depois do catálogo: o caso exige a funcionalidade com a ação executar.
    await instalarCasosUsoIA(tx, Object.values(CASOS_IA_ORC));
  },
};
