import {
  ccsLivresParaTp,
  criarPropostaAcao,
  dadosParaDuplicar,
  duplicarPropostaAcao,
  excluirPropostaAcao,
  listarPropostas,
  naoEncontradoSeNegado,
  novaVersaoPropostaAcao,
  TelaPropostas,
  textoAvisoProposta,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Propostas de TP (US-065): o Orçamentista cria e exclui em Rascunho; GFIN, Auditor e DIREX só consultam.
// Cada um vê só as propostas dos TPs a que está vinculado (RLS, D-P17-9). O Orçamentista também duplica
// (?duplicar=<id> abre o formulário) e cria nova versão (US-066; plano do P18, Task 2).
type Busca = { aviso?: string | string[]; tp?: string | string[]; duplicar?: string | string[] };
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Propostas({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.propostas', 'consultar');
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.propostas:incluir'),
    podeExcluir: ctx.permissoes.has('orc.propostas:excluir'),
    podeVerMetas: ctx.permissoes.has('orc.metas:consultar'),
    podeVerEmpregados: ctx.permissoes.has('orc.empregados:consultar'),
  };
  const busca = await searchParams;
  const idDuplicar = permissoes.podeIncluir ? um(busca.duplicar) : undefined;
  // Os CCs livres e a origem da duplicação só para quem inclui (os casos de uso exigem incluir).
  const [propostas, ccsLivres, origem] = await Promise.all([
    listarPropostas(ctx),
    permissoes.podeIncluir ? ccsLivresParaTp(ctx) : Promise.resolve(null),
    idDuplicar === undefined ? Promise.resolve(undefined) : dadosParaDuplicar(ctx, idDuplicar),
  ]).catch(naoEncontradoSeNegado(ctx));
  return (
    <div>
      <h1>Propostas</h1>
      <TelaPropostas
        propostas={propostas}
        ccsLivres={ccsLivres}
        permissoes={permissoes}
        acoes={{ criar: criarPropostaAcao, excluir: excluirPropostaAcao, duplicar: duplicarPropostaAcao, novaVersao: novaVersaoPropostaAcao }}
        aviso={textoAvisoProposta(um(busca.aviso), um(busca.tp))}
        duplicacao={origem === undefined ? null : { origem }}
      />
    </div>
  );
}
