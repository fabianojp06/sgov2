import { seedAdm, seedAdministradorInicial } from '@/modules/adm';
import { seedCad, seedDadosReferenciaCad } from '@/modules/cad/servidor';
import { criarPrisma, executarSeeds, type Seed } from '@/shared/db';

// Seeds dos módulos (spec §12.3: uma por módulo, este orquestrador só as chama). Rodam com o
// migrator, cada uma na sua transação. O adm vem primeiro: os perfis precisam existir antes das
// permissões padrão que os outros módulos declaram (contrato C6). As do cad vêm do servidor.ts,
// nunca do index.ts (E-N3); os dados de referência só com CARGA_DADOS_REFERENCIA=1 (R15).
const seeds: readonly Seed[] = [seedAdm, seedAdministradorInicial, seedCad, seedDadosReferenciaCad];

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL não definida (veja o .env.example)');

const cliente = criarPrisma(url);
try {
  await executarSeeds(cliente, seeds);
  console.log(`Seeds aplicadas: ${seeds.length}`);
} finally {
  await cliente.$disconnect();
}
