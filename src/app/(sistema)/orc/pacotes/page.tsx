import {
  alterarPacoteAcao,
  excluirPacoteAcao,
  exercicioDoAno,
  iaLiberada,
  incluirPacoteAcao,
  listarExercicios,
  listarPacotes,
  MENSAGENS_ORC,
  naoEncontradoSeNegado,
  opcoesPacote,
  SeletorExercicio,
  sugerirContaCcAcao,
  sugerirJustificativaAcao,
  TelaPacotes,
  textoAvisoPacote,
} from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Pacotes base zero (US-057): o Gestor de Diretoria lança nos CCs do escopo; a GFIN, em qualquer CC.
type Busca = { ano?: string | string[]; cc?: string | string[]; editar?: string | string[]; aviso?: string | string[]; salvo?: string | string[] };
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Pacotes({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.pacotes', 'consultar');
  const [exercicios, busca] = await Promise.all([listarExercicios(ctx), searchParams]);
  const atual = exercicioDoAno(exercicios, busca.ano);
  if (!atual) {
    return (
      <div>
        <h1>Pacotes base zero</h1>
        <p>{MENSAGENS_ORC.SEM_EXERCICIO}</p>
      </div>
    );
  }
  const [opcoes, lista, iaJustificativa, iaSugestaoConta] = await Promise.all([
    opcoesPacote(ctx, atual.id),
    listarPacotes(ctx, atual.id),
    iaLiberada(ctx, 'justificativa'),
    iaLiberada(ctx, 'sugestaoConta'),
  ]).catch(naoEncontradoSeNegado(ctx));
  // CC pedido só se estiver entre os do escopo ou com pacote visível; senão, o primeiro do escopo.
  const pedido = um(busca.cc);
  const visiveis = new Set([...opcoes.ccs.map((c) => c.classificacao), ...lista.pacotes.map((k) => k.cc)]);
  const ccAtual = pedido && visiveis.has(pedido) ? pedido : (opcoes.ccs[0]?.classificacao ?? lista.pacotes[0]?.cc ?? null);
  return (
    <div>
      <h1>{`Pacotes base zero (${atual.ano})`}</h1>
      <SeletorExercicio exercicios={exercicios} anoAtual={atual.ano} rota="/orc/pacotes" />
      <TelaPacotes
        ano={atual.ano}
        exercicioId={atual.id}
        opcoes={opcoes}
        lista={lista}
        ccAtual={ccAtual}
        emEdicao={um(busca.editar) ?? null}
        gravacao={um(busca.salvo)}
        permissoes={{
          podeIncluir: ctx.permissoes.has('orc.pacotes:incluir'),
          podeAlterar: ctx.permissoes.has('orc.pacotes:alterar'),
          podeExcluir: ctx.permissoes.has('orc.pacotes:excluir'),
        }}
        acoes={{ incluir: incluirPacoteAcao, alterar: alterarPacoteAcao, excluir: excluirPacoteAcao, sugerirJustificativa: sugerirJustificativaAcao, sugerirContaCc: sugerirContaCcAcao }}
        aviso={textoAvisoPacote(um(busca.aviso))}
        iaJustificativa={iaJustificativa}
        iaSugestaoConta={iaSugestaoConta}
      />
    </div>
  );
}
