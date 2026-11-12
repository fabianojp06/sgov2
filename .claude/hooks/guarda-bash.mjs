// Hook PreToolUse (matcher Bash): bloqueia comandos que violam as travas da spec §11.5 e de D12.
// Lê o JSON do Claude Code no stdin; ao bloquear, escreve o motivo no stderr e sai com código 2.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { avaliarComando, NOME_URL_BANCO } from './regras.mjs';

/** Lê só as variáveis *_DATABASE_URL do .env e do .env.local da raiz do projeto (as que o prisma.config.ts carrega). */
function lerUrlsDosArquivos(raiz) {
  const urls = {};
  if (!raiz) return urls;
  for (const arquivo of ['.env', '.env.local']) {
    let texto;
    try {
      texto = readFileSync(join(raiz, arquivo), 'utf8');
    } catch {
      continue;
    }
    for (const linha of texto.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
      if (!m || !NOME_URL_BANCO.test(m[1])) continue;
      // Cada arquivo entra com chave própria: todas as URLs encontradas precisam ser de dev local.
      urls[`${arquivo} ${m[1]}`] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return urls;
}

/** Scripts do package.json da raiz (npm run x roda o corpo, que também passa pelas travas, #159). */
function lerScripts(raiz) {
  try {
    return JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return {};
  }
}

/** Ramo em checkout na pasta do comando (git push sem destino vai para ele, #157). */
function lerRamo(pasta) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pasta,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

let bruto = '';
for await (const parte of process.stdin) bruto += parte;

let entrada;
try {
  entrada = JSON.parse(bruto);
} catch {
  process.stderr.write('guarda-bash: entrada do hook não é JSON válido; comando bloqueado por precaução (spec §11.5).\n');
  process.exit(2);
}

const comando = entrada?.tool_input?.command ?? '';
const raiz = process.env.CLAUDE_PROJECT_DIR ?? entrada?.cwd;
// O ramo e os scripts são os da pasta do comando (uma worktree pode não ser a pasta do projeto). O git
// só roda quando o comando fala em push.
const pasta = entrada?.cwd ?? raiz;
const { bloquear, motivo } = avaliarComando(comando, process.env, lerUrlsDosArquivos(raiz), {
  ramoAtual: pasta && /\bpush\b/.test(comando) ? lerRamo(pasta) : undefined,
  scripts: pasta ? lerScripts(pasta) : {},
});
if (bloquear) {
  process.stderr.write(`Comando bloqueado pelo hook do SGO: ${motivo}\nExceção só com pedido explícito do PO.\n`);
  process.exit(2);
}
process.exit(0);
