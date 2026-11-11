import { instalarFuncionalidades, type DeclaracaoFuncionalidade } from '@/modules/adm/servidor';
import type { Seed } from '@/shared/db';

// Funcionalidades do int (contrato C6). A primeira é o cadastro da IA (US-019 parte 2): a chave
// geral, os limites e os casos de uso, no menu Cadastros (o menu Administração é só do adm).
// Sem @/shared/authz nem next/: o prisma/seed.ts importa pelo servidor.ts.
export const FUNCIONALIDADES_INT: readonly DeclaracaoFuncionalidade[] = [
  {
    codigo: 'int.ia',
    modulo: 'CADASTROS',
    grupo: 'Sistema',
    nome: 'Inteligência artificial',
    rota: '/int/ia',
    ordem: 90,
    ajuda:
      'Liga e desliga a IA (chave geral e cada caso de uso), define o limite de pedidos por minuto de cada pessoa e os tetos ' +
      'mensais de custo, e mostra o consumo do mês. Tudo nasce desligado; ao atingir um teto, só a IA desliga até o mês seguinte.',
    acoes: ['consultar', 'alterar'],
    nivelLog: 'AVANCADO',
    // Spec §4.4: configuração da IA é do Administrador; o Auditor confere o consumo.
    perfisPadrao: { ADMINISTRADOR: ['consultar', 'alterar'], AUDITOR: ['consultar'] },
  },
];

export const seedInt: Seed = {
  nome: 'int',
  async executar(tx) {
    await instalarFuncionalidades(tx, FUNCIONALIDADES_INT);
  },
};
