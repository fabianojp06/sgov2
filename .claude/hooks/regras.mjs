// Regras das travas das sessões do Claude Code (spec §11.5 e D12, US-002).
// Função pura: recebe o comando do Bash e o ambiente e diz se a execução deve ser bloqueada.
// O comando é avaliado inteiro: encadeamentos (&&, ||, ;, |, quebra de linha), variáveis
// inline (VAR=valor cmd), export e subshells (bash -c '...') entram na análise.

const PORTAS_DEV = new Set(['55432', '56432']);
const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const NOMES_VEDADOS = /sgo-prod|sgo-hml/i;
const CAMINHOS_VEDADOS = /\/etc\/easypanel|\/var\/lib\/docker\/volumes\/sgo-/i;
const URL_PG = /postgres(?:ql)?:\/\/[^\s'"`;|&)]+/gi;
const ATRIBUICAO = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const PREFIXOS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time']);
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
  const plano = comando.replace(/["'`]/g, ' ').replace(/\$\(|\)/g, ' ; ');
  return plano
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0);
}

function semPrefixos(tokens, envSegmento) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const m = ATRIBUICAO.exec(t);
    if (m) {
      envSegmento[m[1]] = m[2];
      i += 1;
    } else if (PREFIXOS.has(t) || (t.startsWith('-') && i > 0 && PREFIXOS.has(tokens[i - 1]))) {
      i += 1;
    } else {
      break;
    }
  }
  return tokens.slice(i);
}

function nomeBase(t) {
  return t.split('/').pop() ?? t;
}

function temSequencia(tokens, a, b) {
  return tokens.some((t, i) => t === a && tokens[i + 1] === b);
}

function avaliarPrisma(tokens, env) {
  if (!tokens.some((t) => nomeBase(t) === 'prisma')) return null;
  const reset = temSequencia(tokens, 'migrate', 'reset');
  const push = temSequencia(tokens, 'db', 'push');
  const diff = temSequencia(tokens, 'migrate', 'diff');
  const dev = temSequencia(tokens, 'migrate', 'dev');
  if (!reset && !push && !diff && !dev) return null;

  const urls = [...tokens.join(' ').matchAll(URL_PG)].map((m) => m[0]);
  for (const nome of ['DATABASE_URL', 'SHADOW_DATABASE_URL']) {
    if (env[nome]) urls.push(env[nome]);
  }
  if ((reset || push) && urls.length === 0) {
    return `${MOTIVO_BANCO} DATABASE_URL ausente: não dá para saber qual banco seria alterado.`;
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
    if (t === '-h' || t === '--host') host = tokens[i + 1];
    else if (t.startsWith('--host=')) host = t.slice(7);
    else if (t.startsWith('-h') && t.length > 2) host = t.slice(2);
    else if (t === '-p' || t === '--port') porta = tokens[i + 1];
    else if (t.startsWith('--port=')) porta = t.slice(7);
    else if (/^postgres(?:ql)?:\/\//i.test(t)) urls.push(t);
    else if (t.startsWith('--dbname=') && /^--dbname=postgres(?:ql)?:\/\//i.test(t)) urls.push(t.slice(9));
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
 * @param {Record<string, string | undefined>} env
 * @returns {{ bloquear: boolean; motivo?: string }}
 */
export function avaliarComando(comando, env) {
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
    const motivo = avaliarPrisma(tokens, envSegmento) ?? avaliarClientePg(tokens, envSegmento) ?? avaliarGitPush(tokens);
    if (motivo) return { bloquear: true, motivo };
  }
  return { bloquear: false };
}
