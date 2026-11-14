import { alterarBemAcao, excluirBemAcao, incluirBemAcao, listarBens, naoEncontradoSeNegado, opcoesBem, TelaBens, textoAvisoBem, type FormularioBemAberto } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Bens, serviços e equipamentos (CAPEX) da proposta de TP (US-072): o Orçamentista lança na última versão, em
// Rascunho ou Em Elaboração; GFIN, Auditor e DIREX só consultam. Cada um vê só as propostas dos TPs a que está
// vinculado (RLS). ?nova=<proposta> e ?editar=<bem> abrem o formulário (plano do P22, Task 2).
type Chave = 'aviso' | 'd' | 'tipo' | 'proposta' | 'meta' | 'descricao' | 'conta' | 'inicio' | 'fim' | 'zerados' | 'inativos' | 'nova' | 'editar';
type Busca = Partial<Record<Chave, string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Bens({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.bens', 'consultar');
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.bens:incluir'),
    podeAlterar: ctx.permissoes.has('orc.bens:alterar'),
    podeExcluir: ctx.permissoes.has('orc.bens:excluir'),
  };
  const busca = await searchParams;
  const filtros = {
    tipo: um(busca.tipo),
    proposta: um(busca.proposta),
    meta: um(busca.meta),
    descricao: um(busca.descricao),
    conta: um(busca.conta),
    inicio: um(busca.inicio),
    fim: um(busca.fim),
    exibirZerados: um(busca.zerados) !== 'nao',
    exibirInativos: um(busca.inativos) === 'sim',
  };
  const nova = um(busca.nova);
  const editar = um(busca.editar);
  const formulario: FormularioBemAberto | null =
    nova !== undefined && permissoes.podeIncluir ? { modo: 'incluir', propostaId: nova } : editar !== undefined && permissoes.podeAlterar ? { modo: 'alterar', id: editar } : null;
  // Com o formulário aberto, a lista vem sem filtro: o bloco da proposta ou do bem precisa estar nela.
  const blocos = await listarBens(ctx, formulario ? {} : filtros).catch(naoEncontradoSeNegado(ctx));
  const opcoes = formulario ? await opcoesBem(ctx) : null;
  return (
    <div>
      <h1>Bens, Serviços e Equipamentos</h1>
      <TelaBens
        blocos={blocos}
        filtros={filtros}
        permissoes={permissoes}
        acoes={{ incluir: incluirBemAcao, alterar: alterarBemAcao, excluir: excluirBemAcao }}
        opcoes={opcoes}
        aviso={textoAvisoBem(um(busca.aviso), um(busca.d))}
        formulario={formulario}
      />
    </div>
  );
}
