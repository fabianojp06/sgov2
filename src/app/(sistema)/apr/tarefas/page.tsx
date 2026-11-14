import { listarTarefas, obterTarefa, TelaTarefas, textoAvisoTarefa } from '@/modules/apr';
import { naoEncontradoSeNegado } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';
import { decidirSolicitacaoAcao } from './acoes';
import { manipuladoresDosFluxos } from './manipuladores';

// Central de Tarefas (US-078, RF_APR_REQ_002): as solicitações roteadas para o usuário pela alçada; ?abrir=<id>
// mostra a tarefa com o resumo do alvo e as ações (plano do P26, D-P26-8).
type Busca = Partial<Record<'situacao' | 'de' | 'ate' | 'tp' | 'abrir' | 'aviso' | 'd', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function Tarefas({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('apr.tarefas', 'consultar');
  const busca = await searchParams;
  const filtros = { situacao: um(busca.situacao), de: um(busca.de), ate: um(busca.ate), tp: um(busca.tp) };
  const tarefas = await listarTarefas(ctx, filtros).catch(naoEncontradoSeNegado(ctx));
  const abrir = um(busca.abrir);
  const aberta = abrir ? await obterTarefa(ctx, abrir, manipuladoresDosFluxos()) : null;
  return (
    <div>
      <h1>Central de Tarefas</h1>
      {abrir && !aberta && <p role="status">Solicitação não encontrada na sua Central de Tarefas.</p>}
      <TelaTarefas
        tarefas={tarefas}
        filtros={filtros}
        aberta={aberta}
        podeDecidir={ctx.permissoes.has('apr.tarefas:executar')}
        decidir={decidirSolicitacaoAcao}
        aviso={textoAvisoTarefa(um(busca.aviso), um(busca.d))}
      />
    </div>
  );
}
