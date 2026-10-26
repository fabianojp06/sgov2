import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { iniciarBancoTeste } from '../tests/integracao/banco';
import { ADMIN_INICIAL, BASE } from './aut/apoio';

// E2E mínimo de acesso (P5, Task 7; D12). Sobe, nesta ordem:
// 1. o banco efêmero do Testcontainers (127.0.0.1, 512 MB, sem o Ryuk) com as seeds reais;
// 2. o `next start` do build atual em 127.0.0.1:3190;
// 3. o Chromium no contêiner oficial do Playwright (decisão do PO: sem apt no host), com o
//    run-server só em 127.0.0.1 da rede do host, 1 GB e oom_score_adj 500. Os testes rodam no
//    host e conectam nele por PW_TEST_CONNECT_WS_ENDPOINT. Se essa variável já vier definida ou
//    com E2E_NAVEGADOR_LOCAL=1 (CI com o navegador instalado), o contêiner não sobe.
// O teardown derruba o que subiu, em ordem inversa, mesmo se uma etapa falhar.
const VERSAO_PLAYWRIGHT: string = createRequire(import.meta.url)('@playwright/test/package.json').version;
const IMAGEM = `mcr.microsoft.com/playwright:v${VERSAO_PLAYWRIGHT}-noble`;
const PORTA_NAVEGADOR = 3191;

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

function pararServidor(servidor: ChildProcess): Promise<void> {
  if (servidor.exitCode !== null) return Promise.resolve();
  return new Promise((ok) => {
    const forcar = setTimeout(() => servidor.kill('SIGKILL'), 10_000);
    servidor.once('exit', () => (clearTimeout(forcar), ok()));
    servidor.kill('SIGTERM');
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
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

    const ambiente = { ...process.env };
    delete ambiente.SHADOW_DATABASE_URL;
    const servidor = spawn('node_modules/.bin/next', ['start', '--hostname', '127.0.0.1', '--port', new URL(BASE).port], {
      env: {
        ...ambiente,
        NODE_ENV: 'production',
        DATABASE_URL: banco.urlApp,
        FILA_DATABASE_URL: banco.urlFila,
        // Sem texto vazio: o lerEnv recusa URL vazia. O app não usa o migrator, mas o .env.local do
        // dev completaria a variável com o banco de dev.
        MIGRATE_DATABASE_URL: banco.urlMigrator,
        URL_PUBLICA: BASE,
        CONFIAR_PROXY: '',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    limpezas.push(() => pararServidor(servidor));
    await esperar(async () => (await fetch(`${BASE}/login`)).ok, 60_000, 'next start', () => servidor.exitCode !== null);

    if (!process.env.PW_TEST_CONNECT_WS_ENDPOINT && process.env.E2E_NAVEGADOR_LOCAL !== '1') {
      const nome = `sgo-e2e-navegador-${process.pid}`;
      execFileSync('docker', [
        'run', '-d', '--rm', '--name', nome, '--init', '--network', 'host', '--user', 'pwuser',
        '--memory', '1g', '--memory-swap', '1g', '--oom-score-adj', '500', IMAGEM,
        '/bin/sh', '-c', `npx -y playwright@${VERSAO_PLAYWRIGHT} run-server --port ${PORTA_NAVEGADOR} --host 127.0.0.1`,
      ], { stdio: 'ignore', timeout: 60_000 });
      limpezas.push(() => execFileSync('docker', ['rm', '-f', nome], { stdio: 'ignore' }));
      await esperar(() => portaAberta(PORTA_NAVEGADOR), 180_000, 'navegador do Playwright');
      process.env.PW_TEST_CONNECT_WS_ENDPOINT = `ws://127.0.0.1:${PORTA_NAVEGADOR}/`;
    }
    // Os specs alteram a configuração de acesso (manutenção) direto pelo migrator.
    process.env.E2E_MIGRATOR_URL = banco.urlMigrator;
  } catch (erro) {
    await derrubar();
    throw erro;
  }
  return derrubar;
}
