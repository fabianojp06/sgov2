import { notFound } from 'next/navigation';
import { definirTetoAcao, listarExercicios, MENSAGENS_ORC, obterVisaoExercicio, recalcularAcao, SeletorExercicio, VisaoCc } from '@/modules/orc';
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
      <div>
        <h1>Orçamento da Adm. Central</h1>
        <p>{MENSAGENS_ORC.SEM_EXERCICIO}</p>
        {ctx.permissoes.has('orc.exercicios:consultar') && <a href="/orc/exercicios">Exercícios</a>}
      </div>
    );
  }
  const podeAlterar = ctx.permissoes.has('orc.orcamento:alterar') && visao.escopo.tipo === 'TOTAL' && visao.exercicio.editavel;
  const AVISOS: Readonly<Record<string, string>> = { recalculado: MENSAGENS_ORC.RECALCULADO, teto: MENSAGENS_ORC.TETO_DEFINIDO };
  return (
    <div>
      <h1>{`Orçamento da Adm. Central ${visao.exercicio.ano}`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={visao.exercicio.ano} rota="/orc/orcamento" />
      <VisaoCc
        visao={visao}
        podeRecalcular={podeAlterar}
        recalcular={recalcularAcao}
        podeDefinirTeto={podeAlterar}
        definirTeto={definirTetoAcao}
        aviso={typeof aviso === 'string' && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined}
      />
    </div>
  );
}
