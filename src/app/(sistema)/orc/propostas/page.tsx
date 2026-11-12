import {
  ccsLivresParaTp,
  criarPropostaAcao,
  excluirPropostaAcao,
  listarPropostas,
  naoEncontradoSeNegado,
  TelaPropostas,
  textoAvisoProposta,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Propostas de TP (US-065): o Orçamentista cria e exclui em Rascunho; GFIN, Auditor e DIREX só consultam.
// Cada um vê só as propostas dos TPs a que está vinculado (RLS, D-P17-9).
type Busca = { aviso?: string | string[]; tp?: string | string[] };
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Propostas({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.propostas', 'consultar');
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.propostas:incluir'),
    podeExcluir: ctx.permissoes.has('orc.propostas:excluir'),
  };
  // Os CCs livres só para quem inclui (o caso de uso exige incluir).
  const [propostas, ccsLivres, busca] = await Promise.all([
    listarPropostas(ctx),
    permissoes.podeIncluir ? ccsLivresParaTp(ctx) : Promise.resolve(null),
    searchParams,
  ]).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Propostas</h1>
      <TelaPropostas
        propostas={propostas}
        ccsLivres={ccsLivres}
        permissoes={permissoes}
        acoes={{ criar: criarPropostaAcao, excluir: excluirPropostaAcao }}
        aviso={textoAvisoProposta(um(busca.aviso), um(busca.tp))}
      />
    </div>
  );
}
