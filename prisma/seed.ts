import { criarPrisma, executarSeeds, type Seed } from '@/shared/db';

// Seeds dos módulos (entram a partir do P5). Rodam com o migrator, cada uma na sua transação.
const seeds: readonly Seed[] = [];

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL não definida (veja o .env.example)');

const cliente = criarPrisma(url);
try {
  await executarSeeds(cliente, seeds);
  console.log(`Seeds aplicadas: ${seeds.length}`);
} finally {
  await cliente.$disconnect();
}
