import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Os scripts dos hooks de verdade: JSON no stdin, código 2 e motivo no stderr quando bloqueiam.
const dir = fileURLToPath(new URL('.', import.meta.url));
const SIGLA = ['C', 'T', 'C', 'E', 'A'].join('');

function rodar(script, entrada, env = {}) {
  return spawnSync(process.execPath, [join(dir, script)], {
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

describe('guarda-bash.mjs', () => {
  it('bloqueia db push sem DATABASE_URL com código 2 e motivo no stderr', () => {
    const r = rodar('guarda-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'npx prisma db push' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/spec §11\.5/);
  });

  it('libera comando comum com código 0', () => {
    const r = rodar('guarda-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'git status' } });
    expect(r.status).toBe(0);
  });

  it('usa o DATABASE_URL do ambiente da sessão', () => {
    const entrada = { tool_name: 'Bash', tool_input: { command: 'npx prisma migrate reset --force' } };
    expect(rodar('guarda-bash.mjs', entrada, { DATABASE_URL: 'postgresql://u:x@127.0.0.1:55432/sgo_dev' }).status).toBe(0);
    expect(rodar('guarda-bash.mjs', entrada, { DATABASE_URL: 'postgresql://u:x@sgo-prod_db:5432/sgo' }).status).toBe(2);
  });
});

describe('guarda-bash.mjs com .env do projeto', () => {
  const entrada = { tool_name: 'Bash', tool_input: { command: 'npx prisma migrate dev' } };

  it('libera quando o .env do projeto aponta para dev local', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'guarda-'));
    writeFileSync(join(raiz, '.env'), 'MIGRATE_DATABASE_URL="postgresql://u:x@127.0.0.1:55432/sgo_dev"\n');
    expect(rodar('guarda-bash.mjs', entrada, { CLAUDE_PROJECT_DIR: raiz }).status).toBe(0);
  });

  it('bloqueia quando o .env.local do projeto aponta para fora do dev local', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'guarda-'));
    writeFileSync(join(raiz, '.env'), 'MIGRATE_DATABASE_URL="postgresql://u:x@127.0.0.1:55432/sgo_dev"\n');
    writeFileSync(join(raiz, '.env.local'), "export MIGRATE_DATABASE_URL='postgresql://u:x@sgo-prod_db:5432/sgo'\n");
    const r = rodar('guarda-bash.mjs', entrada, { CLAUDE_PROJECT_DIR: raiz });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/spec §11\.5/);
  });
});

describe('alerta-marca.mjs', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'marca-'));
  mkdirSync(join(raiz, 'src'), { recursive: true });
  mkdirSync(join(raiz, 'docs'), { recursive: true });
  const comMarca = join(raiz, 'src', 'a.ts');
  const semMarca = join(raiz, 'src', 'b.ts');
  const docs = join(raiz, 'docs', 'c.md');
  writeFileSync(comMarca, `export const nome = '${SIGLA.toLowerCase()}';\n`);
  writeFileSync(semMarca, "export const nome = 'instituição';\n");
  writeFileSync(docs, `Plano ${SIGLA}\n`);

  it('reprova arquivo de src/ com a marca vedada', () => {
    const r = rodar('alerta-marca.mjs', { tool_name: 'Write', tool_input: { file_path: comMarca }, cwd: raiz }, { CLAUDE_PROJECT_DIR: raiz });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`Marca neutra: remova '${SIGLA}' (spec §6.7)`);
  });

  it('aceita arquivo de src/ sem a marca e arquivo fora das pastas vigiadas', () => {
    expect(rodar('alerta-marca.mjs', { tool_name: 'Edit', tool_input: { file_path: semMarca }, cwd: raiz }, { CLAUDE_PROJECT_DIR: raiz }).status).toBe(0);
    expect(rodar('alerta-marca.mjs', { tool_name: 'Write', tool_input: { file_path: docs }, cwd: raiz }, { CLAUDE_PROJECT_DIR: raiz }).status).toBe(0);
  });
});
