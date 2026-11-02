import { criar, FormExercicio, sugerirAno } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Novo exercício (US-055).
export default async function NovoExercicio() {
  const ctx = await exigirPagina('orc.exercicios', 'incluir');
  const anoPadrao = await sugerirAno(ctx);
  return (
    <main>
      <h1>Novo exercício</h1>
      <FormExercicio anoPadrao={anoPadrao} criar={criar} />
    </main>
  );
}
