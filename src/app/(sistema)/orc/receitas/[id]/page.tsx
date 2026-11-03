import { notFound } from 'next/navigation';
import { alterarReceitaAcao, FormReceita, listarExercicios, MENSAGENS_ORC, naoEncontradoSeNegado, obterReceita } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Alterar a receita do rateio de um TP (US-060).
export default async function AlterarReceita({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirPagina('orc.receitas', 'alterar');
  const { id } = await params;
  const [receita, exercicios] = await Promise.all([obterReceita(ctx, id).catch(naoEncontradoSeNegado(ctx)), listarExercicios(ctx)]);
  const exercicio = receita && exercicios.find((e) => e.id === receita.exercicioId);
  if (!receita || !exercicio) notFound();
  return (
    <div>
      <h1>{`Alterar receita do TP ${receita.tp} (${exercicio.ano})`}</h1>
      {exercicio.situacao === 'RASCUNHO' || exercicio.situacao === 'EM_ELABORACAO' ? (
        <FormReceita ano={exercicio.ano} receita={receita} salvar={alterarReceitaAcao} />
      ) : (
        <p>{MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(exercicio.rotuloSituacao)}</p>
      )}
    </div>
  );
}
