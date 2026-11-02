import type { DeclaracaoFuncionalidade } from '@/modules/adm/servidor';
import { instalarFuncionalidades } from '@/modules/adm/servidor';
import type { Seed } from '@/shared/db';
import { CHAVES_PARAMETRO_SISTEMA, criarParametrosDoAno } from './parametro-sistema';

// Seed do cad em todos os ambientes (plano do P4, R15): as funcionalidades do módulo (contrato C6),
// os parâmetros provisórios de 2027 e o parametro_sistema vazio. A Tabela Mestre entra na Task 10.
// R22/E-N4: sem
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
  {
    codigo: 'cad.parametros',
    modulo: 'CADASTROS',
    grupo: 'Central de Cálculos',
    nome: 'Parâmetros do exercício',
    rota: '/cad/parametros',
    ordem: 1,
    nivelLog: 'SIMPLES',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: {
      GFIN: ['consultar', 'alterar'],
      ORCAMENTISTA: ['consultar'],
      ANALISTA_GRH: ['consultar'],
      AUDITOR: ['consultar'],
      DIREX: ['consultar'],
    },
  },
  {
    codigo: 'cad.salario_minimo',
    modulo: 'CADASTROS',
    grupo: 'Central de Cálculos',
    nome: 'Salário mínimo nacional',
    rota: '/cad/salario-minimo',
    ordem: 2,
    nivelLog: 'SIMPLES',
    acoes: ['consultar', 'alterar'],
    perfisPadrao: {
      ANALISTA_GRH: ['consultar', 'alterar'],
      GFIN: ['consultar', 'alterar'],
      AUDITOR: ['consultar'],
    },
  },
];

const SISTEMA = { usuarioId: null, usuarioRotulo: 'Sistema', sessaoUid: null, ip: null, unidadeId: null };

export const seedCad: Seed = {
  nome: 'cad',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_CAD);
    // Os parâmetros de 2027 nascem provisórios (GAP-ORC-003); um ano que já existe fica como está.
    await criarParametrosDoAno(tx, SISTEMA, 2027);
    for (const chave of CHAVES_PARAMETRO_SISTEMA) {
      await tx.parametroSistema.upsert({ where: { chave }, create: { chave, valor: '' }, update: {} });
    }
  },
};
