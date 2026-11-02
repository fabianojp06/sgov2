import { criar, FormExercicio, sugerirAno } from '@/modules/orc';
import { exigirPagina, negarNaPagina } from '@/shared/authz';

// Novo exercício (US-055).
export default async function NovoExercicio() {
  const ctx = await exigirPagina('orc.exercicios', 'incluir');
  // Com CC de escopo, a criação é recusada (R15): a página responde 404 como sem a permissão.
  const anoPadrao = await sugerirAno(ctx).catch((erro: unknown) => negarNaPagina(ctx, erro));
  return (
    <main>
      <h1>Novo exercício</h1>
      <FormExercicio anoPadrao={anoPadrao} criar={criar} />
    </main>
  );
}
