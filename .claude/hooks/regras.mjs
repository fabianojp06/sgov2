// Regras das travas das sessões do Claude Code (spec §11.5 e D12, US-002).
// Função pura: recebe o comando do Bash e o ambiente e diz se a execução deve ser bloqueada.
// O comando é avaliado inteiro: encadeamentos (&&, ||, ;, |, & e quebra de linha), variáveis
// inline (VAR=valor cmd), export, subshells (bash -c '...', ( ... ), $( ... )), grupos { ...; },
// palavras-chave do shell (if/then/do/!...) e embrulhos (sudo -u x, timeout N, xargs, nice...)
// entram na análise: o comando real é o que vem depois deles.

const PORTAS_DEV = new Set(['55432', '56432']);
const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const NOMES_VEDADOS = /sgo-prod|sgo-hml/i;
const CAMINHOS_VEDADOS = /\/etc\/easypanel|\/var\/lib\/docker\/volumes\/sgo-/i;
const URL_PG = /postgres(?:ql)?:\/\/[^\s'"`;|&)]+/gi;
const ATRIBUICAO = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
// Variáveis de URL de banco que o Prisma pode usar: DATABASE_URL, MIGRATE_DATABASE_URL (datasource do
// prisma.config.ts), SHADOW_DATABASE_URL e qualquer outra *_DATABASE_URL.
export const NOME_URL_BANCO = /^(?:[A-Z0-9_]*_)?DATABASE_URL$/;
const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
// Comandos que só embrulham outro comando: o comando real vem depois das opções (e das opções
// que recebem valor, como sudo -u root) e de um número fixo de posicionais (timeout 10).
const EMBRULHOS = new Map([
  ...SHELLS.map((s) => [s, { comValor: ['-o', '-O', '+o', '+O'], posicionais: 0 }]),
  ['sudo', { comValor: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from', '--command-timeout'], posicionais: 0 }],
  ['env', { comValor: ['-u', '--unset', '-C', '--chdir'], posicionais: 0 }],
  ['command', { comValor: [], posicionais: 0 }],
  ['exec', { comValor: ['-a'], posicionais: 0 }],
  ['eval', { comValor: [], posicionais: 0 }],
  ['nohup', { comValor: [], posicionais: 0 }],
  ['setsid', { comValor: [], posicionais: 0 }],
  ['time', { comValor: ['-f', '-o', '--format', '--output'], posicionais: 0 }],
  ['nice', { comValor: ['-n', '--adjustment'], posicionais: 0 }],
  ['ionice', { comValor: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'], posicionais: 0 }],
  ['stdbuf', { comValor: ['-i', '-o', '-e'], posicionais: 0 }],
  ['watch', { comValor: ['-n', '--interval', '-q', '--equexit'], posicionais: 0 }],
  ['timeout', { comValor: ['-s', '-k', '--signal', '--kill-after'], posicionais: 1 }],
  ['xargs', { comValor: ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--delimiter', '--eof', '--arg-file', '--replace'], posicionais: 0 }],
]);
// Palavras-chave do shell que podem vir antes do comando real (if x; then cmd; fi, ! cmd, { cmd; }).
const PALAVRAS_CHAVE = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}']);
// O CLI do Prisma: prisma, prisma@7, prisma@7.0.0, prisma@latest, @prisma/cli(@x) ou o binário direto.
const CLI_PRISMA = /^(?:@prisma\/cli|prisma)(?:@\S+)?$/;
const BINARIO_PRISMA = /(?:^|\/)prisma\/build\/index\.js$/;
const COMANDOS_DE_CONTEINER = new Set(['docker', 'docker-compose', 'podman', 'nsenter', 'ctr', 'crictl']);
const CLIENTES_PG = new Set(['psql', 'pg_dump', 'pg_dumpall', 'pg_restore']);

const MOTIVO_BANCO =
  'Trava de banco (spec §11.5): migrate reset, db push, migrate diff e migrate dev só contra o banco de dev local (127.0.0.1:55432 ou 127.0.0.1:56432).';
const MOTIVO_PROD =
  'Trava de produção (D12, spec §11.5): as sessões de dev não acessam contêineres, volumes, redes nem variáveis de sgo-prod/sgo-hml nem o /etc/easypanel.';
const MOTIVO_PSQL =
  'Trava de banco (spec §11.5, D12): clientes do PostgreSQL só se conectam ao banco de dev local (127.0.0.1:55432 ou 127.0.0.1:56432).';
const MOTIVO_MAIN =
  'Trava da main (spec §12.5, regra inviolável 4 da memória do projeto): a main é protegida, tudo entra por PR. Não faça push para main.';

/** Banco "dev local" = host 127.0.0.1/localhost e porta 55432 ou 56432. */
export function ehDevLocal(url) {
  try {
    const u = new URL(url);
    return HOSTS_LOCAIS.has(u.hostname) && PORTAS_DEV.has(u.port);
  } catch {
    return false;
  }
}

function segmentar(comando) {
  // Aspas viram espaço: o conteúdo de bash -c '...' passa a ser analisado como comando comum.
  // ( e ) delimitam subshells; o & isolado (segundo plano) separa comandos, mas não o de
  // redirecionamentos como 2>&1, >&2 e &>arquivo.
  const plano = comando.replace(/["'`]/g, ' ').replace(/\$\(|[()]/g, ' ; ');
  return plano
    .split(/&&|\|\||\|&|[;|\n]|(?<![<>])&(?!>)/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0);
}

/** Tira variáveis inline e embrulhos (sudo, timeout, bash -c, xargs...) até chegar ao comando real. */
function semPrefixos(tokens, envSegmento) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const m = ATRIBUICAO.exec(t);
    if (m) {
      envSegmento[m[1]] = m[2];
      i += 1;
      continue;
    }
    if (PALAVRAS_CHAVE.has(t)) {
      i += 1;
      continue;
    }
    const embrulho = EMBRULHOS.get(nomeBase(t));
    if (!embrulho) break;
    i += 1;
    while (i < tokens.length && /^[-+]/.test(tokens[i]) && tokens[i] !== '+') {
      i += embrulho.comValor.includes(tokens[i]) ? 2 : 1;
    }
    i += embrulho.posicionais;
  }
  return tokens.slice(i);
}

function nomeBase(t) {
  return t.split('/').pop() ?? t;
}

function ehPrisma(t) {
  return CLI_PRISMA.test(t) || CLI_PRISMA.test(nomeBase(t)) || BINARIO_PRISMA.test(t);
}

function temSequencia(tokens, a, b) {
  return tokens.some((t, i) => t === a && tokens[i + 1] === b);
}

function avaliarPrisma(tokens, env, envArquivos) {
  if (!tokens.some(ehPrisma)) return null;
  const reset = temSequencia(tokens, 'migrate', 'reset');
  const push = temSequencia(tokens, 'db', 'push');
  const diff = temSequencia(tokens, 'migrate', 'diff');
  const dev = temSequencia(tokens, 'migrate', 'dev');
  if (!reset && !push && !diff && !dev) return null;

  const urls = [...tokens.join(' ').matchAll(URL_PG)].map((m) => m[0]);
  for (const [nome, valor] of Object.entries(env)) {
    if (NOME_URL_BANCO.test(nome) && valor) urls.push(valor);
  }
  // As URLs dos arquivos já chegam filtradas (só *_DATABASE_URL), com a chave "arquivo NOME".
  for (const valor of Object.values(envArquivos)) {
    if (valor) urls.push(valor);
  }
  // migrate diff só toca banco quando usa datasource, migrations (shadow) ou URL; schema contra schema não.
  const diffComBanco =
    diff && tokens.some((t) => /^--(?:from|to)-(?:config-datasource|migrations|url)\b|^--shadow-database-url\b/.test(t));
  if ((reset || push || dev || diffComBanco) && urls.length === 0) {
    return `${MOTIVO_BANCO} Nenhuma URL de banco visível (DATABASE_URL, MIGRATE_DATABASE_URL, SHADOW_DATABASE_URL): não dá para saber qual banco seria alterado.`;
  }
  const fora = urls.filter((u) => !ehDevLocal(u));
  if (fora.length > 0) return MOTIVO_BANCO;
  return null;
}

function avaliarClientePg(tokens, env) {
  if (!CLIENTES_PG.has(nomeBase(tokens[0]))) return null;
  let host = env.PGHOST;
  let porta = env.PGPORT;
  const urls = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    // --dbname= aceita URL ou conninfo (chave=valor); o valor é avaliado como argumento solto.
    const v = t.startsWith('--dbname=') ? t.slice(9) : t;
    let m;
    if (t === '-h' || t === '--host') host = tokens[i + 1];
    else if (t.startsWith('--host=')) host = t.slice(7);
    else if (t.startsWith('-h') && t.length > 2) host = t.slice(2);
    else if (t === '-p' || t === '--port') porta = tokens[i + 1];
    else if (t.startsWith('--port=')) porta = t.slice(7);
    else if (/^postgres(?:ql)?:\/\//i.test(v)) urls.push(v);
    else if ((m = /^(?:host|hostaddr)=(.*)$/i.exec(v))) host = m[1];
    else if ((m = /^port=(.*)$/i.exec(v))) porta = m[1];
  }
  if (urls.some((u) => !ehDevLocal(u))) return MOTIVO_PSQL;
  // Sem host: socket local do próprio servidor (o banco de prod fica em contêiner, sem porta pública).
  if (host === undefined) return null;
  if (!HOSTS_LOCAIS.has(host) || !PORTAS_DEV.has(porta ?? '5432')) return MOTIVO_PSQL;
  return null;
}

function avaliarGitPush(tokens) {
  if (nomeBase(tokens[0]) !== 'git') return null;
  const i = tokens.indexOf('push');
  if (i < 0) return null;
  const args = tokens.slice(i + 1);
  if (args.some((a) => a === '--mirror' || a === '--all')) return MOTIVO_MAIN;
  const posicionais = args.filter((a) => !a.startsWith('-'));
  // O primeiro posicional é o remoto; os demais são refspecs.
  const refspecs = posicionais.slice(1);
  if (refspecs.some((r) => /^\+?(?:[^:]*:)?(?:refs\/heads\/)?main$/.test(r))) return MOTIVO_MAIN;
  return null;
}

/**
 * @param {string} comando
 * @param {Record<string, string | undefined>} env ambiente da sessão
 * @param {Record<string, string | undefined>} [envArquivos] URLs lidas do .env/.env.local do projeto
 *   (as que o prisma.config.ts carrega); todas precisam ser de dev local.
 * @returns {{ bloquear: boolean; motivo?: string }}
 */
export function avaliarComando(comando, env, envArquivos = {}) {
  if (typeof comando !== 'string' || comando.trim() === '') return { bloquear: false };
  if (CAMINHOS_VEDADOS.test(comando)) return { bloquear: true, motivo: MOTIVO_PROD };

  const envEfetivo = { ...env };
  for (const bruto of segmentar(comando)) {
    // export VAR=valor e VAR=valor sozinho valem para os segmentos seguintes.
    if (bruto[0] === 'export' || bruto.every((t) => ATRIBUICAO.test(t))) {
      for (const t of bruto) {
        const m = ATRIBUICAO.exec(t);
        if (m) envEfetivo[m[1]] = m[2];
      }
      continue;
    }
    const envSegmento = { ...envEfetivo };
    const tokens = semPrefixos(bruto, envSegmento);
    if (tokens.length === 0) continue;

    if (COMANDOS_DE_CONTEINER.has(nomeBase(tokens[0])) && NOMES_VEDADOS.test(tokens.join(' '))) {
      return { bloquear: true, motivo: MOTIVO_PROD };
    }
    if (CLIENTES_PG.has(nomeBase(tokens[0])) && NOMES_VEDADOS.test(tokens.join(' '))) {
      return { bloquear: true, motivo: MOTIVO_PROD };
    }
    const motivo = avaliarPrisma(tokens, envSegmento, envArquivos) ?? avaliarClientePg(tokens, envSegmento) ?? avaliarGitPush(tokens);
    if (motivo) return { bloquear: true, motivo };
  }
  return { bloquear: false };
}
