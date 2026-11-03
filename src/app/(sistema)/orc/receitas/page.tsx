import {
  excluirReceitaAcao,
  exercicioDoAno,
  ListaReceitas,
  listarExercicios,
  listarReceitas,
  naoEncontradoSeNegado,
  SeletorExercicio,
  textoAvisoReceita,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Receitas – Rateio dos TPs (US-060): digitadas pela GFIN na transição (C35).
export default async function Receitas({ searchParams }: { searchParams: Promise<{ ano?: string | string[]; aviso?: string | string[] }> }) {
  const ctx = await exigirPagina('orc.receitas', 'consultar');
  const [exercicios, { ano, aviso }] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, ano);
  if (!atual) {
    return (
      <div>
        <h1>Receitas – Rateio dos TPs</h1>
        <p>Nenhum exercício cadastrado.</p>
      </div>
    );
  }
  const dados = await listarReceitas(ctx, atual.id).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>{`Receitas – Rateio dos TPs (${atual.ano})`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={atual.ano} rota="/orc/receitas" />
      <ListaReceitas
        ano={atual.ano}
        {...dados}
        permissoes={{
          podeIncluir: ctx.permissoes.has('orc.receitas:incluir'),
          podeAlterar: ctx.permissoes.has('orc.receitas:alterar'),
          podeExcluir: ctx.permissoes.has('orc.receitas:excluir'),
        }}
        excluir={excluirReceitaAcao}
        aviso={textoAvisoReceita(typeof aviso === 'string' ? aviso : undefined)}
      />
    </div>
  );
}
