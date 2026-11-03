// Seletor de exercício no topo das telas do orçamento (US-055, §6.6): um link por ano, com a
// situação; o atual leva aria-current. Server Component.
export type OpcaoExercicio = { ano: number; rotuloSituacao: string };

export function SeletorExercicio({ exercicios, anoAtual, rota }: { exercicios: readonly OpcaoExercicio[]; anoAtual: number | null; rota: string }) {
  if (exercicios.length === 0) return null;
  return (
    <nav aria-label="Exercício">
      <ul>
        {exercicios.map((e) => (
          <li key={e.ano}>
            <a href={`${rota}?ano=${e.ano}`} {...(e.ano === anoAtual ? { 'aria-current': 'page' as const } : {})}>
              {`${e.ano} (${e.rotuloSituacao})`}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
