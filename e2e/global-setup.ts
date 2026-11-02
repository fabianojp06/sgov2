import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { iniciarBancoTeste } from '../tests/integracao/banco';
import { ADMIN_INICIAL, BASE } from './aut/apoio';

// E2E mínimo de acesso (P5, Task 7) na VPS de produção (D12). Sobe, nesta ordem:
// 1. o banco efêmero do Testcontainers (127.0.0.1, 512 MB, oom 500, sem o Ryuk) com as seeds reais;
// 2. o `next start` do build atual em 127.0.0.1:3190, com oom 500, heap limitado e só as variáveis
//    do teste (o .env.local completa o que faltar, por isso as sensíveis vão vazias);
// 3. o Chromium no contêiner oficial do Playwright (decisão do PO: sem apt no host), numa rede
//    bridge própria sem comunicação entre contêineres, sem capabilities, 1 GB, oom 500 e prazo de
//    45 min. O run-server é o playwright-core do node_modules (versão do lock, sem npm), publicado
//    só em 127.0.0.1 com caminho aleatório. O navegador chega ao app pelo túnel do cliente
//    (exposeNetwork <loopback>), sem a rede do host. Com PW_TEST_CONNECT_WS_ENDPOINT já definida
//    ou E2E_NAVEGADOR_LOCAL=1 (CI com o navegador instalado), o contêiner não sobe.
// O teardown derruba tudo em ordem inversa, mesmo com falha no meio. Se o processo morrer antes
// (SIGKILL, OOM), a próxima execução remove o que tiver a label sgo-e2e=1; o banco órfão sai com:
//   docker rm -f $(docker ps -aq --filter label=org.testcontainers=true)
const exigir = createRequire(import.meta.url);
const VERSAO_PLAYWRIGHT: string = exigir('playwright-core/package.json').version;
const DIR_PLAYWRIGHT_CORE = dirname(exigir.resolve('playwright-core/package.json'));
const IMAGEM = `mcr.microsoft.com/playwright:v${VERSAO_PLAYWRIGHT}-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f`;
const ROTULO = 'sgo-e2e=1';
const PORTA_APP = Number(new URL(BASE).port);
const PORTA_NAVEGADOR = 3191;
const PRAZO_NAVEGADOR_S = 45 * 60;

async function esperar(condicao: () => Promise<boolean>, prazoMs: number, descricao: string, morreu?: () => boolean): Promise<void> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    if (morreu?.()) throw new Error(`${descricao}: o processo terminou antes de responder`);
    if (await condicao().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${descricao}: sem resposta em ${prazoMs / 1000} s`);
}

const portaAberta = (porta: number) =>
  new Promise<boolean>((ok) => {
    const s = createConnection({ host: '127.0.0.1', port: porta });
    s.once('connect', () => (s.end(), ok(true)));
    s.once('error', () => ok(false));
  });

async function exigirPortaLivre(porta: number): Promise<void> {
  if (await portaAberta(porta)) {
    throw new Error(`porta ${porta} ocupada em 127.0.0.1 (outra execução do E2E ou processo órfão); libere-a antes`);
  }
}

const docker = (args: string[], timeout = 60_000) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const tolerante = (args: string[]) => () => {
  try {
    docker(args);
  } catch {
    // já não existe
  }
};

// Restos de uma execução que morreu antes do teardown (só o que tem a label do E2E).
function removerOrfaos(): void {
  const conteineres = docker(['ps', '-aq', '--filter', `label=${ROTULO}`]).split('\n').filter(Boolean);
  if (conteineres.length > 0) docker(['rm', '-f', ...conteineres]);
  const redes = docker(['network', 'ls', '-q', '--filter', `label=${ROTULO}`]).split('\n').filter(Boolean);
  if (redes.length > 0) docker(['network', 'rm', ...redes]);
}

function pararServidor(servidor: ChildProcess): Promise<void> {
  if (servidor.exitCode !== null) return Promise.resolve();
  return new Promise((ok) => {
    const forcar = setTimeout(() => servidor.kill('SIGKILL'), 10_000);
    servidor.once('exit', () => (clearTimeout(forcar), ok()));
    servidor.kill('SIGTERM');
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync('.next/BUILD_ID')) throw new Error('sem build: rode `npm run build` antes do E2E, e não ao mesmo tempo (D12)');
  const limpezas: (() => unknown)[] = [];
  const derrubar = async () => {
    for (const limpar of limpezas.reverse()) {
      try {
        await limpar();
      } catch (erro) {
        console.error('[E2E] falha na limpeza', erro);
      }
    }
  };
  try {
    const usarConteiner = !process.env.PW_TEST_CONNECT_WS_ENDPOINT && process.env.E2E_NAVEGADOR_LOCAL !== '1';
    if (usarConteiner) removerOrfaos();
    await exigirPortaLivre(PORTA_APP);
    if (usarConteiner) await exigirPortaLivre(PORTA_NAVEGADOR);

    const banco = await iniciarBancoTeste();
    limpezas.push(() => banco.parar());
    execFileSync('npx', ['tsx', 'e2e/aut/semear.ts'], {
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: banco.urlMigrator,
        ADMIN_INICIAL_LOGIN: ADMIN_INICIAL.login,
        ADMIN_INICIAL_EMAIL: ADMIN_INICIAL.email,
        ADMIN_INICIAL_SENHA: ADMIN_INICIAL.senha,
      },
      stdio: 'inherit',
      timeout: 120_000,
    });

    const servidor = spawn('choom', ['-n', '500', '--', 'node_modules/.bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(PORTA_APP)], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG ?? 'C.UTF-8',
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=768',
        NEXT_TELEMETRY_DISABLED: '1',
        DATABASE_URL: banco.urlApp,
        FILA_DATABASE_URL: banco.urlFila,
        // O app não usa o migrator; a chave vai definida para o .env.local não pôr a do dev.
        MIGRATE_DATABASE_URL: banco.urlMigrator,
        URL_PUBLICA: BASE,
        CONFIAR_PROXY: '',
        ADMIN_INICIAL_LOGIN: '',
        ADMIN_INICIAL_EMAIL: '',
        ADMIN_INICIAL_SENHA: '',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    limpezas.push(() => pararServidor(servidor));
    await esperar(
      async () => (await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) })).ok,
      60_000,
      'next start',
      () => servidor.exitCode !== null,
    );

    if (usarConteiner) {
      try {
        docker(['image', 'inspect', IMAGEM]);
      } catch {
        docker(['pull', IMAGEM], 900_000);
      }
      const nome = `sgo-e2e-navegador-${process.pid}`;
      const caminho = `/${randomBytes(16).toString('hex')}`;
      // A limpeza vem antes do docker run: um run interrompido no meio não deixa nada para trás.
      limpezas.push(tolerante(['network', 'rm', nome]));
      limpezas.push(tolerante(['rm', '-f', nome]));
      docker(['network', 'create', '--label', ROTULO, '-o', 'com.docker.network.bridge.enable_icc=false', nome]);
      docker([
        'run', '-d', '--rm', '--name', nome, '--label', ROTULO, '--network', nome, '--init', '--user', 'pwuser',
        '-p', `127.0.0.1:${PORTA_NAVEGADOR}:${PORTA_NAVEGADOR}`,
        '--memory', '1g', '--memory-swap', '1g', '--oom-score-adj', '500', '--pids-limit', '512',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', `${DIR_PLAYWRIGHT_CORE}:/pw:ro`,
        IMAGEM, 'timeout', String(PRAZO_NAVEGADOR_S),
        'node', '/pw/cli.js', 'run-server', '--host', '0.0.0.0', '--port', String(PORTA_NAVEGADOR), '--path', caminho,
      ]);
      const rodando = () => {
        try {
          return docker(['inspect', '-f', '{{.State.Running}}', nome]) === 'true';
        } catch {
          return false;
        }
      };
      // Com -p, o docker-proxy aceita a conexão antes do run-server escutar: vale só resposta HTTP.
      const responde = async () => (await fetch(`http://127.0.0.1:${PORTA_NAVEGADOR}/`, { signal: AbortSignal.timeout(3000) }), true);
      await esperar(responde, 60_000, 'navegador do Playwright', () => !rodando());
      process.env.PW_TEST_CONNECT_WS_ENDPOINT = `ws://127.0.0.1:${PORTA_NAVEGADOR}${caminho}`;
      process.env.PW_TEST_CONNECT_EXPOSE_NETWORK = '<loopback>';
    }
    // Os specs alteram a configuração de acesso (manutenção) direto pelo migrator do banco efêmero.
    process.env.E2E_MIGRATOR_URL = banco.urlMigrator;
  } catch (erro) {
    await derrubar();
    throw erro;
  }
  return derrubar;
}
