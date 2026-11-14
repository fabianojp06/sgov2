import { lerFiltrosSalvos } from '@/modules/ger';

// "Mostrar inativos" das consultas em árvore retido na sessão (US-021, pendência do #245), como os
// filtros da grade: no sessionStorage, com o escopo da sessão (outra sessão no mesmo navegador não herda).

export const chaveInativos = (idGrade: string) => `sgo.grade.${idGrade}.inativos`;

/** O valor salvo nesta sessão; de outra sessão, ausente ou corrompido → false. */
export function inativosSalvos(texto: string | null, escopo: string): boolean {
  return lerFiltrosSalvos(texto, escopo)?.inativos === true;
}

export const textoInativos = (escopo: string, mostrar: boolean) => JSON.stringify({ escopo, valores: { inativos: mostrar } });
