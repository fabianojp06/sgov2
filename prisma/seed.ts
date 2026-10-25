import { seedAdm, seedAdministradorInicial } from '@/modules/adm';
import { criarPrisma, executarSeeds, type Seed } from '@/shared/db';

// Seeds dos módulos (spec §12.3: uma por módulo, este orquestrador só as chama). Rodam com o
// migrator, cada uma na sua transação. O adm vem primeiro: os perfis precisam existir antes das
// permissões padrão que os outros módulos declaram (contrato C6).
const seeds: readonly Seed[] = [seedAdm, seedAdministradorInicial];

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL não definida (veja o .env.example)');

const cliente = criarPrisma(url);
try {
  await executarSeeds(cliente, seeds);
  console.log(`Seeds aplicadas: ${seeds.length}`);
} finally {
  await cliente.$disconnect();
}
