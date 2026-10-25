import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

// Banco efêmero para os testes de integração, na VPS de produção (D12):
// - memória limitada a 512 MB, sem swap extra, e oom_score_adj 500 (morre antes da produção);
// - porta publicada só em 127.0.0.1 (o Testcontainers publica em 0.0.0.0, e o ufw não
//   filtra portas do Docker);
// - sem o Ryuk (TESTCONTAINERS_RYUK_DISABLED no vitest.config.ts): ele publicaria em 0.0.0.0
//   uma porta que aceita filtros para remover contêineres. Quem chama sempre usa parar().
//   Se o processo morrer no meio (SIGKILL, OOM), limpar com:
//   docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)
const MEMORIA = 512 * 1024 * 1024;

class PostgresLocal extends PostgreSqlContainer {
  override async start(): Promise<StartedPostgreSqlContainer> {
    const ligacoes = (this.hostConfig.PortBindings ?? {}) as Record<string, { HostIp?: string }[]>;
    for (const lista of Object.values(ligacoes)) {
      for (const ligacao of lista) ligacao.HostIp = '127.0.0.1';
    }
    this.hostConfig.Memory = MEMORIA;
    this.hostConfig.MemorySwap = MEMORIA;
    this.hostConfig.OomScoreAdj = 500;
    return super.start();
  }
}

const raiz = process.cwd();

// Limitação: o 01-papeis.sql é executado comando a comando no banco padrão do contêiner,
// separado por ";". Não suporta meta-comandos do psql (\connect) nem corpos $$...$$;
// a Tarefa 9 (schema pgboss) precisa adaptar este helper.
async function aplicarPapeis(urlAdmin: string): Promise<void> {
  const admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    // Um comando por vez: CREATE DATABASE não roda dentro do bloco implícito de um script.
    const script = readFileSync(join(raiz, 'docker/postgres/init/01-papeis.sql'), 'utf8');
    const comandos = script.replace(/^--.*$/gm, '').split(';').map((c) => c.trim()).filter(Boolean);
    for (const comando of comandos) {
      try {
        await admin.query(comando);
      } catch (erro) {
        throw new Error(`01-papeis.sql falhou em: ${comando.slice(0, 60)}`, { cause: erro });
      }
    }
  } finally {
    await admin.end();
  }
}

function migrarDeploy(urlMigrator: string): void {
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: raiz,
      env: { ...process.env, MIGRATE_DATABASE_URL: urlMigrator, SHADOW_DATABASE_URL: '' },
      stdio: 'pipe',
      timeout: 90_000,
    });
  } catch (erro) {
    const { stdout, stderr } = erro as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy falhou:\n${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`, {
      cause: erro,
    });
  }
}

export async function iniciarBancoTeste(): Promise<{
  urlApp: string;
  urlMigrator: string;
  idContainer: string;
  parar(): Promise<void>;
}> {
  const container = await new PostgresLocal('pgvector/pgvector:pg16').start();
  try {
    const host = `${container.getHost()}:${container.getPort()}`;
    await aplicarPapeis(container.getConnectionUri());
    const urlMigrator = `postgresql://sgo_migrator:sgo_migrator@${host}/sgo_teste`;
    migrarDeploy(urlMigrator);
    return {
      urlApp: `postgresql://sgo_app:sgo_app@${host}/sgo_teste`,
      urlMigrator,
      idContainer: container.getId(),
      parar: async () => {
        await container.stop();
      },
    };
  } catch (erro) {
    // Não deixar o erro da limpeza esconder a causa real.
    try {
      await container.stop();
    } catch (erroParada) {
      throw new AggregateError([erro, erroParada], 'falha ao iniciar o banco de teste e ao parar o contêiner', {
        cause: erroParada,
      });
    }
    throw erro;
  }
}
