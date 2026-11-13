import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm/servidor';
import type { Seed } from '@/shared/db';
import { instalarCasosUsoIA } from '@/shared/ia';
import { CASO_AJUDA_MANUAL } from '../application/ia-casos';

// Funcionalidades do rel (contrato C6), no menu Relatórios. A primeira é a conferência da carga
// inicial (plano do P7, Task 2; US-115), que a GFIN confere contra as planilhas de origem. A segunda,
// as exportações em segundo plano de cada pessoa (US-024). A terceira, fora do menu, é a permissão da
// ajuda da IA no manual (US-108).
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
];

export const seedRel: Seed = {
  nome: 'rel',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_REL);
    // Depois do catálogo: o caso exige a funcionalidade com a ação executar.
    await instalarCasosUsoIA(tx, [CASO_AJUDA_MANUAL]);
  },
};
