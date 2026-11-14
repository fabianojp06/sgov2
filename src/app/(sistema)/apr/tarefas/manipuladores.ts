import type { Manipuladores } from '@/modules/apr';
import { manipuladorWa01 } from '@/modules/orc';

// Os manipuladores dos fluxos de aprovação (US-078; plano do P26, D-P26-5): cada módulo dono de um fluxo entra
// aqui. WA01 (oficialização da proposta) é do orc (US-079); WA05 chega com a US-080. Sem manipulador, a Central
// mostra a tarefa e recusa a decisão.
export function manipuladoresDosFluxos(): Manipuladores {
  return { WA01: manipuladorWa01() };
}
