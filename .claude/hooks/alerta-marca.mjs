// Hook PostToolUse (matcher Write|Edit): a marca vedada não pode aparecer em src/, prisma/ nem worker/
// (spec §6.7). Se aparecer, sai com código 2 e avisa a sessão para remover.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

// A sigla é montada em tempo de execução para o próprio código não conter o texto literal.
const SIGLA = ['C', 'T', 'C', 'E', 'A'].join('');
const MARCA = new RegExp(SIGLA, 'i');
const PASTAS = ['src/', 'prisma/', 'worker/'];

let bruto = '';
for await (const parte of process.stdin) bruto += parte;

let entrada;
try {
  entrada = JSON.parse(bruto);
} catch {
  process.exit(0);
}

const arquivo = entrada?.tool_input?.file_path;
if (typeof arquivo !== 'string' || arquivo === '') process.exit(0);

const raiz = process.env.CLAUDE_PROJECT_DIR ?? entrada.cwd ?? process.cwd();
const absoluto = isAbsolute(arquivo) ? arquivo : resolve(raiz, arquivo);
const rel = relative(raiz, absoluto).split('\\').join('/');
if (!PASTAS.some((p) => rel.startsWith(p)) || !existsSync(absoluto)) process.exit(0);

if (MARCA.test(readFileSync(absoluto, 'utf8'))) {
  process.stderr.write(`Marca neutra: remova '${SIGLA}' (spec §6.7) de ${rel}. O nome exibido vem de instituicao.nome_exibicao.\n`);
  process.exit(2);
}
process.exit(0);
