import type { Manipuladores } from '@/modules/apr';
import { manipuladorWa01, manipuladorWa02, manipuladorWa05 } from '@/modules/orc';

// Os manipuladores dos fluxos de aprovação (US-078; plano do P26, D-P26-5): cada módulo dono de um fluxo entra
// aqui. WA01 (oficialização da proposta, US-079), WA02 (validação das viagens, US-081) e WA05 (lote de pessoal, US-080) são do orc. Sem manipulador, a Central
// mostra a tarefa e recusa a decisão.
export function manipuladoresDosFluxos(): Manipuladores {
  return { WA01: manipuladorWa01(), WA02: manipuladorWa02(), WA05: manipuladorWa05() };
}
