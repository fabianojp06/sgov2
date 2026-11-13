import { alterarMetaAcao, excluirMetaAcao, incluirMetaAcao, listarMetas, naoEncontradoSeNegado, TelaMetas, textoAvisoMeta, type FormularioMetaAberto } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Metas da proposta de TP (US-067): o Orçamentista inclui, altera e exclui as metas da última versão, em
// Rascunho ou Em Elaboração; GFIN, Auditor e DIREX só consultam. Cada um vê só as propostas dos TPs a que está
// vinculado (RLS). ?nova=<proposta> e ?editar=<meta> abrem o formulário (plano do P19, Task 2).
type Busca = Partial<Record<'aviso' | 'm' | 'tipo' | 'proposta' | 'meta' | 'nova' | 'editar', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Metas({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.metas', 'consultar');
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.metas:incluir'),
    podeAlterar: ctx.permissoes.has('orc.metas:alterar'),
    podeExcluir: ctx.permissoes.has('orc.metas:excluir'),
  };
  const busca = await searchParams;
  const filtros = { tipo: um(busca.tipo), proposta: um(busca.proposta), meta: um(busca.meta) };
  const nova = um(busca.nova);
  const editar = um(busca.editar);
  const formulario: FormularioMetaAberto | null =
    nova !== undefined && permissoes.podeIncluir
      ? { modo: 'incluir', propostaId: nova }
      : editar !== undefined && permissoes.podeAlterar
        ? { modo: 'alterar', metaId: editar }
        : null;
  // Com o formulário aberto, a lista vem sem filtro: o bloco da proposta ou da meta precisa estar nela.
  const blocos = await listarMetas(ctx, formulario ? {} : filtros).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Metas</h1>
      <TelaMetas
        blocos={blocos}
        filtros={filtros}
        permissoes={permissoes}
        acoes={{ incluir: incluirMetaAcao, alterar: alterarMetaAcao, excluir: excluirMetaAcao }}
        aviso={textoAvisoMeta(um(busca.aviso), um(busca.m))}
        formulario={formulario}
      />
    </div>
  );
}
