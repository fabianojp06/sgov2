import { notFound } from 'next/navigation';
import { exercicioDoAno, FormReceita, incluirReceitaAcao, listarExercicios, listarReceitas, MENSAGENS_ORC, naoEncontradoSeNegado } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Nova receita do rateio de um TP (US-060).
export default async function NovaReceita({ searchParams }: { searchParams: Promise<{ ano?: string | string[] }> }) {
  const ctx = await exigirPagina('orc.receitas', 'incluir');
  const [exercicios, { ano }] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, ano);
  if (!atual) notFound();
  // Com CC de escopo, 404 (R15); fora de edição, o aviso no lugar do formulário.
  const { editavel } = await listarReceitas(ctx, atual.id).catch(naoEncontradoSeNegado(ctx));
  return (
    <main>
      <h1>{`Nova receita (${atual.ano})`}</h1>
      {editavel ? (
        <FormReceita ano={atual.ano} exercicioId={atual.id} salvar={incluirReceitaAcao} />
      ) : (
        <p>{MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(atual.rotuloSituacao)}</p>
      )}
    </main>
  );
}
