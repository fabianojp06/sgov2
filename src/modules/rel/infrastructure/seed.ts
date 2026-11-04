import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm/servidor';
import type { Seed } from '@/shared/db';

// Funcionalidades do rel (contrato C6), no menu Relatórios. A primeira é a conferência da carga
// inicial (plano do P7, Task 2; US-115), que a GFIN confere contra as planilhas de origem.
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
    perfisPadrao: { GFIN: ['consultar', 'exportar'], AUDITOR: ['consultar', 'exportar'], DIREX: ['consultar'] },
  },
];

export const seedRel: Seed = {
  nome: 'rel',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_REL);
  },
};
