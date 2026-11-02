import { notFound } from 'next/navigation';
import { alterarReceitaAcao, FormReceita, listarExercicios, naoEncontradoSeNegado, obterReceita } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Alterar a receita do rateio de um TP (US-060).
export default async function AlterarReceita({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirPagina('orc.receitas', 'alterar');
  const { id } = await params;
  const [receita, exercicios] = await Promise.all([obterReceita(ctx, id).catch(naoEncontradoSeNegado), listarExercicios(ctx)]);
  const exercicio = receita && exercicios.find((e) => e.id === receita.exercicioId);
  if (!receita || !exercicio) notFound();
  return (
    <main>
      <h1>{`Alterar receita do TP ${receita.tp} (${exercicio.ano})`}</h1>
      <FormReceita ano={exercicio.ano} receita={receita} salvar={alterarReceitaAcao} />
    </main>
  );
}
