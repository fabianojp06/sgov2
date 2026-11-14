import type { Manipuladores } from '@/modules/apr';

// Os manipuladores dos fluxos de aprovação (US-078; plano do P26, D-P26-5): cada módulo dono de um fluxo entra
// aqui (o WA01 do orc chega com a US-079). Sem manipulador, a Central mostra a tarefa e recusa a decisão.
export function manipuladoresDosFluxos(): Manipuladores {
  return {};
}
