import {
  exercicioDoAno,
  ligarCargoAcao,
  listarCorrespondencias,
  listarExercicios,
  MENSAGENS_ORC,
  naoEncontradoSeNegado,
  SeletorExercicio,
  TelaCorrespondencia,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Correspondência do cargo em texto com o cadastro de C&S (US-056, #410): só para quem altera posição
// com escopo TOTAL (D-P16-1); o Gestor de Diretoria recebe 404.
type Busca = { ano?: string | string[]; ligadas?: string | string[] };
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Correspondencia({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.posicoes', 'alterar');
  const [exercicios, busca] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, busca.ano);
  if (!atual) {
    return (
      <div>
        <h1>Cargos em texto</h1>
        <p>{MENSAGENS_ORC.SEM_EXERCICIO}</p>
      </div>
    );
  }
  const lista = await listarCorrespondencias(ctx, atual.id).catch(naoEncontradoSeNegado(ctx));
  const ligadas = Number(um(busca.ligadas));
  const aviso = Number.isInteger(ligadas) && ligadas > 0 ? MENSAGENS_ORC.CORRESPONDENCIA_LIGADA(ligadas) : undefined;
  return (
    <div>
      <h1>{`Cargos em texto (${atual.ano})`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={atual.ano} rota="/orc/posicoes/correspondencia" />
      <TelaCorrespondencia ano={atual.ano} exercicioId={atual.id} lista={lista} acao={ligarCargoAcao} aviso={aviso} />
    </div>
  );
}
