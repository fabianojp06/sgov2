// Hook PreToolUse (matcher Bash): bloqueia comandos que violam as travas da spec §11.5 e de D12.
// Lê o JSON do Claude Code no stdin; ao bloquear, escreve o motivo no stderr e sai com código 2.
import { avaliarComando } from './regras.mjs';

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
const { bloquear, motivo } = avaliarComando(comando, process.env);
if (bloquear) {
  process.stderr.write(`Comando bloqueado pelo hook do SGO: ${motivo}\nExceção só com pedido explícito do PO.\n`);
  process.exit(2);
}
process.exit(0);
