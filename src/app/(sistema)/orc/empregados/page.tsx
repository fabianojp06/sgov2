import {
  alterarEmpregadoAcao,
  aprovadoresDoLote,
  finalizarLotePessoalAcao,
  cargosParaEmpregado,
  excluirEmpregadoAcao,
  incluirEmpregadoAcao,
  listarEmpregados,
  naoEncontradoSeNegado,
  TelaEmpregados,
  textoAvisoEmpregado,
  type FormularioPessoalAberto,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Empregados da proposta de TP (US-070): o Orçamentista e o Analista GRH lançam os empregados e as vagas
// "A CONTRATAR" da última versão, em Rascunho ou Em Elaboração; GFIN, Auditor e DIREX só consultam, sem o custo.
// Cada um vê só as propostas dos TPs a que está vinculado (RLS). ?nova=<proposta> e ?editar=<empregado> abrem
// o formulário (plano do P20, Task 2).
type Busca = Partial<Record<'aviso' | 'o' | 'n' | 'tipo' | 'proposta' | 'meta' | 'nova' | 'editar', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Empregados({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.empregados', 'consultar');
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.empregados:incluir'),
    podeAlterar: ctx.permissoes.has('orc.empregados:alterar'),
    podeExcluir: ctx.permissoes.has('orc.empregados:excluir'),
    podeFinalizar: ctx.permissoes.has('orc.empregados:executar'),
  };
  const busca = await searchParams;
  const filtros = { tipo: um(busca.tipo), proposta: um(busca.proposta), meta: um(busca.meta) };
  const nova = um(busca.nova);
  const editar = um(busca.editar);
  const formulario: FormularioPessoalAberto | null =
    nova !== undefined && permissoes.podeIncluir
      ? { modo: 'incluir', propostaId: nova }
      : editar !== undefined && permissoes.podeAlterar
        ? { modo: 'alterar', id: editar }
        : null;
  // Com o formulário aberto, a lista vem sem filtro: o bloco da proposta ou do empregado precisa estar nela.
  const blocos = await listarEmpregados(ctx, formulario ? {} : filtros).catch(naoEncontradoSeNegado(ctx));
  const cargos = formulario ? await cargosParaEmpregado(ctx) : [];
  // US-080: o [Finalizar Lançamentos] e os aprovadores da alçada WA05, só para quem finaliza (o GRH).
  const finalizacao = permissoes.podeFinalizar ? { acao: finalizarLotePessoalAcao, aprovadores: await aprovadoresDoLote(ctx) } : undefined;
  return (
    <div>
      <h1>Empregados</h1>
      <TelaEmpregados
        blocos={blocos}
        filtros={filtros}
        permissoes={permissoes}
        acoes={{ incluir: incluirEmpregadoAcao, alterar: alterarEmpregadoAcao, excluir: excluirEmpregadoAcao }}
        cargos={cargos}
        aviso={textoAvisoEmpregado(um(busca.aviso), um(busca.o), um(busca.n))}
        formulario={formulario}
        finalizacao={finalizacao}
      />
    </div>
  );
}
