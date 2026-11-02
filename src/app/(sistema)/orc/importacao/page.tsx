import { exercicioDoAno, FormImportacao, importarPlanilhaAcao, listarExercicios, MENSAGENS_ORC, SeletorExercicio } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Importar a planilha-modelo do exercício (US-121).
export default async function Importacao({ searchParams }: { searchParams: Promise<{ ano?: string | string[] }> }) {
  const ctx = await exigirPagina('orc.importacao', 'consultar');
  const [exercicios, { ano }] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, ano);
  const editavel = atual !== null && (atual.situacao === 'RASCUNHO' || atual.situacao === 'EM_ELABORACAO');
  return (
    <main>
      <h1>{atual ? `Importar planilha (${atual.ano})` : 'Importar planilha'}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={atual?.ano ?? null} rota="/orc/importacao" />
      {!atual ? (
        <p>Nenhum exercício cadastrado.</p>
      ) : !editavel ? (
        <p>{MENSAGENS_ORC.SITUACAO_NAO_EDITAVEL(atual.rotuloSituacao)}</p>
      ) : ctx.permissoes.has('orc.importacao:executar') ? (
        <FormImportacao exercicioId={atual.id} importar={importarPlanilhaAcao} />
      ) : (
        <p>Você pode consultar esta tela, mas não importar.</p>
      )}
    </main>
  );
}
