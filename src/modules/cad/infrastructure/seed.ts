import type { DeclaracaoFuncionalidade } from '@/modules/adm';
import { instalarFuncionalidades } from '@/modules/adm';
import type { Seed } from '@/shared/db';

// Seed do cad em todos os ambientes (plano do P4, R15): as funcionalidades do módulo (contrato C6).
// Os parâmetros por exercício e a Tabela Mestre entram nas Tasks 9a e 10. R22/E-N4: sem
// @/shared/authz nem next/, porque o prisma/seed.ts a importa pelo servidor.ts.
export const FUNCIONALIDADES_CAD: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'cad.plano_contas',
    modulo: 'CADASTROS',
    grupo: 'Plano de Contas',
    nome: 'Plano de Contas',
    rota: '/cad/plano-contas',
    ordem: 1,
    nivelLog: 'SIMPLES',
    acoes: ['consultar', 'executar'],
    perfisPadrao: {
      GFIN: ['consultar', 'executar'],
      ORCAMENTISTA: ['consultar'],
      ANALISTA_GRH: ['consultar'],
      OPERADOR_VIAGENS: ['consultar'],
      AUDITOR: ['consultar'],
      GESTOR_DIRETORIA: ['consultar'],
      DIREX: ['consultar'],
    },
  },
];

export const seedCad: Seed = {
  nome: 'cad',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_CAD);
  },
};
