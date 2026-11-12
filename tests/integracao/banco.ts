import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

// Aplica os scripts de docker/postgres/init em ordem, como o entrypoint do Postgres faz.
// Cada comando separado por ";"; "\connect banco" troca de banco. Não suporta corpos $$...$$.
async function aplicarPapeis(urlAdmin: string): Promise<void> {
  const dir = join(raiz, 'docker/postgres/init');
  const scripts = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
  let admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    for (const nome of scripts) {
      const linhas = readFileSync(join(dir, nome), 'utf8').replace(/^--.*$/gm, '').split('\n');
      let pendente = '';
      for (const linha of linhas) {
        const troca = /^\\connect\s+(\w+)\s*$/.exec(linha.trim());
        if (troca) {
          await admin.end();
          const url = new URL(urlAdmin);
          url.pathname = `/${troca[1]}`;
          admin = new pg.Client({ connectionString: url.toString() });
          await admin.connect();
          continue;
        }
        pendente += `${linha}\n`;
        let fim = pendente.indexOf(';');
        while (fim >= 0) {
          const comando = pendente.slice(0, fim).trim();
          pendente = pendente.slice(fim + 1);
          if (comando) {
            try {
              await admin.query(comando);
            } catch (erro) {
              throw new Error(`${nome} falhou em: ${comando.slice(0, 60)}`, { cause: erro });
            }
          }
          fim = pendente.indexOf(';');
        }
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

// A mesma imagem do CI (.github/workflows/ci.yml) e de hml/prod (docker/postgres-ambiente.Dockerfile),
// fixada pelo digest (#165): a tag pg16 anda sozinha. Ao trocar, trocar nos três lugares.
export const IMAGEM_BANCO = 'pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a';

export async function iniciarBancoTeste(): Promise<{
  urlApp: string;
  urlMigrator: string;
  urlFila: string;
  idContainer: string;
  parar(): Promise<void>;
}> {
  const container = await new PostgresLocal(IMAGEM_BANCO).start();
  try {
    const host = `${container.getHost()}:${container.getPort()}`;
    await aplicarPapeis(container.getConnectionUri());
    const urlMigrator = `postgresql://sgo_migrator:sgo_migrator@${host}/sgo_teste`;
    migrarDeploy(urlMigrator);
    return {
      urlApp: `postgresql://sgo_app:sgo_app@${host}/sgo_teste`,
      urlMigrator,
      urlFila: `postgresql://sgo_fila:sgo_fila@${host}/sgo_teste`,
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
