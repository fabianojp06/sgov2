import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

// Banco efêmero para os testes de integração, na VPS de produção (D12):
// - memória limitada a 512 MB;
// - porta publicada só em 127.0.0.1 (o Testcontainers publica em 0.0.0.0, e o ufw não
//   filtra portas do Docker);
// - sem o Ryuk (TESTCONTAINERS_RYUK_DISABLED no vitest.config.ts): ele publicaria em 0.0.0.0
//   uma porta que aceita filtros para remover contêineres. Quem chama sempre usa parar().
class PostgresLocal extends PostgreSqlContainer {
  override async start(): Promise<StartedPostgreSqlContainer> {
    const ligacoes = (this.hostConfig.PortBindings ?? {}) as Record<string, { HostIp?: string }[]>;
    for (const lista of Object.values(ligacoes)) {
      for (const ligacao of lista) ligacao.HostIp = '127.0.0.1';
    }
    return super.start();
  }
}

const raiz = process.cwd();

export async function iniciarBancoTeste(): Promise<{ urlApp: string; urlMigrator: string; parar(): Promise<void> }> {
  const container = await new PostgresLocal('pgvector/pgvector:pg16')
    .withResourcesQuota({ memory: 0.5 })
    .start();
  try {
    const host = `${container.getHost()}:${container.getPort()}`;
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    try {
      // Um comando por vez: CREATE DATABASE não roda dentro do bloco implícito de um script.
      const script = readFileSync(join(raiz, 'docker/postgres/init/01-papeis.sql'), 'utf8');
      const comandos = script.replace(/^--.*$/gm, '').split(';').map((c) => c.trim()).filter(Boolean);
      for (const comando of comandos) await admin.query(comando);
    } finally {
      await admin.end();
    }
    const urlMigrator = `postgresql://sgo_migrator:sgo_migrator@${host}/sgo_teste`;
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: raiz,
      env: { ...process.env, MIGRATE_DATABASE_URL: urlMigrator, SHADOW_DATABASE_URL: '' },
      stdio: 'pipe',
    });
    return {
      urlApp: `postgresql://sgo_app:sgo_app@${host}/sgo_teste`,
      urlMigrator,
      parar: async () => {
        await container.stop();
      },
    };
  } catch (erro) {
    await container.stop();
    throw erro;
  }
}
