import {
  alterarTetoAcao,
  alterarViagemAcao,
  excluirTetoAcao,
  excluirViagemAcao,
  incluirTetoAcao,
  incluirViagemAcao,
  listarViagens,
  naoEncontradoSeNegado,
  opcoesViagem,
  TelaViagens,
  textoAvisoViagem,
  type FormularioViagemAberto,
} from "@/modules/orc";
import { exigirPagina } from "@/shared/authz";

// Viagens da proposta de TP (US-071): o Orçamentista e o Operador de Viagens lançam os tetos por conta sintética
// e as viagens da última versão, em Rascunho ou Em Elaboração; GFIN, Auditor e DIREX só consultam. Cada um vê só
// as propostas dos TPs a que está vinculado (RLS). ?nova=, ?copiar= e ?editar= abrem o formulário da viagem;
// ?novoTeto= e ?editarTeto=, o do teto (plano do P21, Task 2).
type Chave =
  | "aviso"
  | "l"
  | "c"
  | "tipo"
  | "proposta"
  | "meta"
  | "localidade"
  | "nova"
  | "copiar"
  | "editar"
  | "novoTeto"
  | "editarTeto";
type Busca = Partial<Record<Chave, string | string[]>>;
const um = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : undefined;

function formularioDa(
  busca: Busca,
  p: { podeIncluir: boolean; podeAlterar: boolean },
): FormularioViagemAberto | null {
  const [nova, copiar, editar, novoTeto, editarTeto] = [
    um(busca.nova),
    um(busca.copiar),
    um(busca.editar),
    um(busca.novoTeto),
    um(busca.editarTeto),
  ];
  if (nova !== undefined && p.podeIncluir)
    return { modo: "incluir", propostaId: nova };
  if (copiar !== undefined && p.podeIncluir)
    return { modo: "copiar", id: copiar };
  if (editar !== undefined && p.podeAlterar)
    return { modo: "alterar", id: editar };
  if (novoTeto !== undefined && p.podeIncluir)
    return { modo: "incluirTeto", propostaId: novoTeto };
  if (editarTeto !== undefined && p.podeAlterar)
    return { modo: "alterarTeto", id: editarTeto };
  return null;
}

export default async function Viagens({
  searchParams,
}: {
  searchParams: Promise<Busca>;
}) {
  const ctx = await exigirPagina("orc.viagens", "consultar");
  const permissoes = {
    podeIncluir: ctx.permissoes.has("orc.viagens:incluir"),
    podeAlterar: ctx.permissoes.has("orc.viagens:alterar"),
    podeExcluir: ctx.permissoes.has("orc.viagens:excluir"),
  };
  const busca = await searchParams;
  const filtros = {
    tipo: um(busca.tipo),
    proposta: um(busca.proposta),
    meta: um(busca.meta),
    localidade: um(busca.localidade),
  };
  const formulario = formularioDa(busca, permissoes);
  // Com o formulário aberto, a lista vem sem filtro: o bloco da proposta, da viagem ou do teto precisa estar nela.
  const blocos = await listarViagens(ctx, formulario ? {} : filtros).catch(
    naoEncontradoSeNegado(ctx),
  );
  const opcoes = formulario ? await opcoesViagem(ctx) : null;
  return (
    <div>
      <h1>Viagens</h1>
      <TelaViagens
        blocos={blocos}
        filtros={filtros}
        permissoes={permissoes}
        acoes={{
          incluir: incluirViagemAcao,
          alterar: alterarViagemAcao,
          excluir: excluirViagemAcao,
          incluirTeto: incluirTetoAcao,
          alterarTeto: alterarTetoAcao,
          excluirTeto: excluirTetoAcao,
        }}
        opcoes={opcoes}
        aviso={textoAvisoViagem(um(busca.aviso), um(busca.l), um(busca.c))}
        formulario={formulario}
      />
    </div>
  );
}
