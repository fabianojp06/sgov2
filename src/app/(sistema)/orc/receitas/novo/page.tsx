import { notFound } from 'next/navigation';
import { exercicioDoAno, FormReceita, incluirReceitaAcao, listarExercicios } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Nova receita do rateio de um TP (US-060).
export default async function NovaReceita({ searchParams }: { searchParams: Promise<{ ano?: string | string[] }> }) {
  const ctx = await exigirPagina('orc.receitas', 'incluir');
  const [exercicios, { ano }] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, ano);
  if (!atual) notFound();
  return (
    <main>
      <h1>{`Nova receita (${atual.ano})`}</h1>
      <FormReceita ano={atual.ano} exercicioId={atual.id} salvar={incluirReceitaAcao} />
    </main>
  );
}
