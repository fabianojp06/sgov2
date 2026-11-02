import { notFound } from 'next/navigation';
import { listarExercicios, MENSAGENS_ORC, obterVisaoExercicio, recalcularAcao, SeletorExercicio, VisaoCc } from '@/modules/orc';
import { exigirPagina, negarNaPagina } from '@/shared/authz';
import { ErroDominio } from '@/shared/kernel';

// Orçamento da Adm. Central: visão por centro de custo (US-058).
type Busca = { ano?: string | string[]; cc?: string | string[]; aviso?: string | string[] };

export default async function Orcamento({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.orcamento', 'consultar');
  const { ano, cc, aviso } = await searchParams;
  const anoPedido = typeof ano === 'string' && /^\d{4}$/.test(ano) ? Number(ano) : null;
  const ccPedido = typeof cc === 'string' && cc.length <= 30 ? cc : null;
  const [exercicios, visao] = await Promise.all([
    listarExercicios(ctx),
    // CC fora do escopo: 404 com a negação auditada; CC inexistente: 404.
    obterVisaoExercicio(ctx, anoPedido, ccPedido).catch((erro: unknown) => {
      if (erro instanceof ErroDominio && erro.codigo === 'orc.cc_inexistente') notFound();
      return negarNaPagina(ctx, erro);
    }),
  ]);
  if (!visao) {
    return (
      <main>
        <h1>Orçamento da Adm. Central</h1>
        <p>{MENSAGENS_ORC.SEM_EXERCICIO}</p>
        {ctx.permissoes.has('orc.exercicios:consultar') && <a href="/orc/exercicios">Exercícios</a>}
      </main>
    );
  }
  return (
    <main>
      <h1>{`Orçamento da Adm. Central ${visao.exercicio.ano}`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={visao.exercicio.ano} rota="/orc/orcamento" />
      <VisaoCc
        visao={visao}
        podeRecalcular={ctx.permissoes.has('orc.orcamento:alterar') && visao.escopo.tipo === 'TOTAL' && visao.exercicio.editavel}
        recalcular={recalcularAcao}
        aviso={aviso === 'recalculado' ? MENSAGENS_ORC.RECALCULADO : undefined}
      />
    </main>
  );
}
