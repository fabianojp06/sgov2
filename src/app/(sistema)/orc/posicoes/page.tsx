import {
  alterarPosicaoAcao,
  cargosParaPosicao,
  excluirPosicaoAcao,
  exercicioDoAno,
  incluirPosicaoAcao,
  listarExercicios,
  listarPosicoes,
  MENSAGENS_ORC,
  naoEncontradoSeNegado,
  opcoesPosicao,
  previaPosicaoAcao,
  SeletorExercicio,
  TelaPosicoes,
  textoAvisoPosicao,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Posições de pessoal (US-056): o Gestor de Diretoria lança nos CCs do escopo; a GFIN, em qualquer CC.
type Busca = { ano?: string | string[]; cc?: string | string[]; editar?: string | string[]; aviso?: string | string[] };
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Posicoes({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.posicoes', 'consultar');
  const [exercicios, busca] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, busca.ano);
  if (!atual) {
    return (
      <div>
        <h1>Posições de pessoal</h1>
        <p>{MENSAGENS_ORC.SEM_EXERCICIO}</p>
      </div>
    );
  }
  const [opcoes, lista] = await Promise.all([opcoesPosicao(ctx, atual.id), listarPosicoes(ctx, atual.id)]).catch(naoEncontradoSeNegado(ctx));
  // CC pedido só se estiver entre os do escopo ou com posição visível; senão, o primeiro do escopo.
  const pedido = um(busca.cc);
  const visiveis = new Set([...opcoes.ccs.map((c) => c.classificacao), ...lista.posicoes.map((p) => p.cc)]);
  const ccAtual = pedido && visiveis.has(pedido) ? pedido : (opcoes.ccs[0]?.classificacao ?? lista.posicoes[0]?.cc ?? null);
  const permissoes = {
    podeIncluir: ctx.permissoes.has('orc.posicoes:incluir'),
    podeAlterar: ctx.permissoes.has('orc.posicoes:alterar'),
    podeExcluir: ctx.permissoes.has('orc.posicoes:excluir'),
  };
  // Cargos do cadastro de C&S (P15, D-P15-5): só quando o formulário aparece, com a mesma condição do
  // TelaPosicoes (alteração da posição pedida no CC, ou inclusão num CC das opções); quem só consulta não
  // recebe a lista, e a leitura com salário não grava CONSULTA à toa.
  const editar = um(busca.editar);
  const mostraFormulario =
    lista.editavel &&
    ccAtual !== null &&
    ((permissoes.podeAlterar && lista.posicoes.some((p) => p.cc === ccAtual && p.id === editar)) ||
      (permissoes.podeIncluir && opcoes.ccs.some((c) => c.classificacao === ccAtual)));
  const cargos = mostraFormulario ? await cargosParaPosicao(ctx) : null;
  return (
    <div>
      <h1>{`Posições de pessoal (${atual.ano})`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={atual.ano} rota="/orc/posicoes" />
      <TelaPosicoes
        ano={atual.ano}
        exercicioId={atual.id}
        opcoes={opcoes}
        lista={lista}
        ccAtual={ccAtual}
        emEdicao={editar ?? null}
        permissoes={permissoes}
        cargos={cargos}
        acoes={{ incluir: incluirPosicaoAcao, alterar: alterarPosicaoAcao, excluir: excluirPosicaoAcao, previa: previaPosicaoAcao }}
        aviso={textoAvisoPosicao(um(busca.aviso))}
      />
    </div>
  );
}
