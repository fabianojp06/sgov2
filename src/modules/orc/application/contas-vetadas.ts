import type { IndiceEstruturaFinanceira, PremissasExercicio } from '@/modules/cad/servidor';
import { RAIZES_CONTAS_PESSOAL } from '../domain/planilha';

// Contas que não aceitam pacote base zero: as analíticas sob as raízes de pessoal (§6.6 [PROVISÓRIA]) e
// as contas que as premissas do exercício usam para salário, adicionais, férias, 13º, encargos e
// benefícios (decisão do PO de 03/11: os encargos 4.1.1.8.x ficavam de fora das raízes). Assim o custo
// de pessoal só entra pelo motor do C2, nunca como pacote.
export function contasVetadasEmPacote(indice: IndiceEstruturaFinanceira, premissas: PremissasExercicio | null): ReadonlySet<string> {
  const vetadas = new Set(RAIZES_CONTAS_PESSOAL.flatMap((r) => indice.contasAnaliticasSob(r)));
  if (premissas) {
    for (const conta of Object.values(premissas.contas)) vetadas.add(conta);
    for (const e of premissas.encargos) vetadas.add(e.conta);
    for (const b of premissas.beneficios) vetadas.add(b.conta);
  }
  return vetadas;
}
