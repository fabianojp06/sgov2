import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm';
import type { Seed } from '@/shared/db';

// Funcionalidades do apr (US-078; plano do P26, D-P26-8) [PROVISÓRIAS], no menu Aprovações › Workflows (spec §6.7).
// A Central de Tarefas mostra só as solicitações roteadas para o próprio usuário; o GFIN (WA01, WA05) e a DIREX
// (que já aprova o orçamento da Adm. Central) consultam e decidem.
export const FUNCIONALIDADES_APR: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'apr.tarefas',
    modulo: 'APROVACOES',
    grupo: 'Workflows',
    nome: 'Central de Tarefas',
    rota: '/apr/tarefas',
    ordem: 1,
    ajuda: 'Lista as solicitações de aprovação roteadas para você pela alçada e permite aprová-las ou rejeitá-las com justificativa.',
    acoes: ['consultar', 'executar'],
    perfisPadrao: { GFIN: ['consultar', 'executar'], DIREX: ['consultar', 'executar'] },
  },
];

export const seedApr: Seed = {
  nome: 'apr',
  executar: async (tx) => {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_APR);
  },
};
