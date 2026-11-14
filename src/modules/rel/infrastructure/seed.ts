import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm/servidor';
import type { Seed } from '@/shared/db';
import { instalarCasosUsoIA } from '@/shared/ia';
import { CASO_AJUDA_MANUAL, CASO_APRESENTACAO, CASO_COMPARATIVO_TPS, CASO_QUADRO_PESSOAL, CASO_RELATORIO_EXECUTIVO } from '../application/ia-casos';

// Funcionalidades do rel (contrato C6), no menu Relatórios. A primeira é a conferência da carga
// inicial (plano do P7, Task 2; US-115), que a GFIN confere contra as planilhas de origem. A segunda,
// as exportações em segundo plano de cada pessoa (US-024). A terceira, fora do menu, é a permissão da
// ajuda da IA no manual (US-108). A quarta, a análise do quadro de pessoal pela IA (US-107). A quinta, o
// comparativo entre TPs (US-106), no menu da Administração Central. A sexta, o relatório executivo mensal (US-103).
// A sétima, o roteiro de apresentação para reunião de diretoria (US-105).
// Sem @/shared/authz nem next/: o prisma/seed.ts importa pelo servidor.ts.
export const FUNCIONALIDADES_REL: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'rel.conferencia_carga',
    modulo: 'RELATORIOS',
    grupo: 'Implantação',
    nome: 'Conferência da carga',
    rota: '/rel/conferencia-carga',
    ordem: 1,
    ajuda:
      'Contagens e totais dos cadastros (plano de contas, centros de custo, cargos, tabela salarial e parâmetros do ' +
      'exercício) para conferir a carga contra as planilhas de origem. A soma dos salários só aparece para quem consulta salários.',
    acoes: ['consultar', 'exportar'],
    // Plano do P7 (Task 2): GFIN e Administrador; Auditor e DIREX leem (§11.3: leitura dos módulos).
    perfisPadrao: { GFIN: ['consultar', 'exportar'], ADMINISTRADOR: ['consultar', 'exportar'], AUDITOR: ['consultar', 'exportar'], DIREX: ['consultar'] },
  },
  {
    codigo: 'rel.exportacoes',
    modulo: 'RELATORIOS',
    grupo: 'Arquivos',
    nome: 'Minhas exportações',
    rota: '/rel/exportacoes',
    ordem: 2,
    ajuda:
      'Exportações acima de 5.000 linhas, geradas em segundo plano: acompanhe a situação e baixe o arquivo quando ficar pronto. ' +
      'Cada pessoa vê só os próprios pedidos, dos últimos 7 dias.',
    acoes: ['consultar'],
    // US-024: todos os perfis (a lista é só dos próprios pedidos; baixar exige o exportar da listagem de origem).
    perfisPadrao: {
      ADMINISTRADOR: ['consultar'],
      ANALISTA_GRH: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
      GESTOR_DIRETORIA: ['consultar'],
      GFIN: ['consultar'],
      OPERADOR_VIAGENS: ['consultar'],
      ORCAMENTISTA: ['consultar'],
    },
  },
  {
    codigo: 'rel.ia_ajuda_manual',
    modulo: 'RELATORIOS',
    grupo: 'Ajuda',
    nome: 'IA: pergunte ao manual',
    rota: '/rel/manual',
    ordem: 3,
    ajuda: 'Pergunta "como faço..." respondida pela IA só com o manual do seu perfil, com os trechos citados. A IA só sugere; confira na tela.',
    exibirNoMenu: false,
    acoes: ['executar'],
    // US-108: todos os perfis, como o manual. O caso nasce desligado e com teto zero; quem liga é o Administrador (/int/ia).
    perfisPadrao: {
      ADMINISTRADOR: ['executar'],
      ANALISTA_GRH: ['executar'],
      AUDITOR: ['executar'],
      DIREX: ['executar'],
      GESTOR_DIRETORIA: ['executar'],
      GFIN: ['executar'],
      OPERADOR_VIAGENS: ['executar'],
      ORCAMENTISTA: ['executar'],
    },
  },
  {
    codigo: 'rel.ia_quadro_pessoal',
    modulo: 'RELATORIOS',
    grupo: 'Análises com IA',
    nome: 'Análise do quadro de pessoal',
    rota: '/rel/quadro-pessoal',
    ordem: 4,
    ajuda:
      'Agregados do pessoal lançado nas propostas (postos por categoria, vagas "A CONTRATAR", evolução por ano, postos por cargo e o custo total da proposta, quando permitido) e, com a IA ' +
      'ligada, uma análise redigida a partir só desses agregados, sem nomes nem salários individuais. Exige também consultar os Empregados das propostas.',
    acoes: ['consultar', 'executar'],
    // US-107 (IA-07): Analista GRH (o ator da história), a DIREX e a GFIN. Todos já consultam orc.empregados.
    // Quem vê o custo continua decidido pelo orc (D-P20-5). O caso nasce desligado e com teto zero (/int/ia).
    perfisPadrao: { ANALISTA_GRH: ['consultar', 'executar'], DIREX: ['consultar', 'executar'], GFIN: ['consultar', 'executar'] },
  },
  {
    codigo: 'rel.comparativo_tps',
    // US-106 (IA-17): "só no menu da Adm. Central", junto do Consolidado dos TPs (orc.consolidado, #510).
    modulo: 'ADM_CENTRAL',
    grupo: 'Orçamento da Adm. Central',
    nome: 'Comparativo entre TPs',
    rota: '/rel/comparativo-tps',
    ordem: 12,
    ajuda:
      'Os Termos de Parceria lado a lado: peso do pessoal, da Administração Central, das viagens e dos bens no Valor Global, custo médio ' +
      'por meta e execução, com os pontos fora da curva marcados. Com a IA ligada, comentários sobre esses pontos. Exige consultar o Consolidado dos TPs.',
    acoes: ['consultar', 'executar'],
    // Os mesmos perfis do Consolidado (D-P31-1, provisório): DIREX e GFIN. O caso nasce desligado e com teto zero (/int/ia).
    perfisPadrao: { DIREX: ['consultar', 'executar'], GFIN: ['consultar', 'executar'] },
  },
  {
    codigo: 'rel.relatorio_executivo',
    modulo: 'RELATORIOS',
    grupo: 'Análises com IA',
    nome: 'Relatório executivo mensal',
    rota: '/rel/relatorio-executivo',
    ordem: 5,
    ajuda:
      'Rascunho do relatório do mês para diretores e gerentes: indicadores da Administração Central e dos TPs, gráficos do sistema e, com a IA ' +
      'ligada, resumo, riscos e recomendações. A GFIN revisa, edita e aprova antes de distribuir; o PDF do rascunho sai marcado "não distribuir".',
    acoes: ['consultar', 'executar', 'alterar', 'aprovar', 'exportar'],
    // US-103 (IA-14): a GFIN gera, revisa e aprova; a DIREX consulta e baixa os aprovados. O caso nasce desligado e com teto zero (/int/ia).
    perfisPadrao: { GFIN: ['consultar', 'executar', 'alterar', 'aprovar', 'exportar'], DIREX: ['consultar', 'exportar'] },
  },
  {
    codigo: 'rel.apresentacao_diretoria',
    modulo: 'RELATORIOS',
    grupo: 'Análises com IA',
    nome: 'Apresentação para reunião de diretoria',
    rota: '/rel/apresentacao',
    ordem: 6,
    ajuda:
      'Com a IA ligada, monta o roteiro dos slides sobre um tema (títulos, tópicos, notas do apresentador e gráficos do sistema) a partir dos dados ' +
      'consolidados da Administração Central e dos TPs. Revise e baixe os slides em PDF.',
    acoes: ['consultar', 'executar', 'exportar'],
    // US-105 (IA-15): a GFIN prepara as reuniões. O caso nasce desligado e com teto zero (/int/ia).
    perfisPadrao: { GFIN: ['consultar', 'executar', 'exportar'] },
  },
];

export const seedRel: Seed = {
  nome: 'rel',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_REL);
    // Depois do catálogo: o caso exige a funcionalidade com a ação executar.
    await instalarCasosUsoIA(tx, [CASO_AJUDA_MANUAL, CASO_QUADRO_PESSOAL, CASO_COMPARATIVO_TPS, CASO_RELATORIO_EXECUTIVO, CASO_APRESENTACAO]);
  },
};
