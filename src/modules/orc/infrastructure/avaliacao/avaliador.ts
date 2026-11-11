import { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas, obterPremissasExercicio } from '@/modules/cad/servidor';
import { prisma } from '@/shared/db';
import { servicoIA, type AvaliadorCasoIA, type PedidoAvaliacaoIA, type ServicoIA } from '@/shared/ia';
import { ErroDominio } from '@/shared/kernel';
import type { DepsOrc } from '../../application/deps';
import { CASOS_IA_ORC } from '../../application/ia-casos';
import { FUNCOES_PESSOA_IA, remontarPessoaIA, type DepsPessoaIA } from '../../application/ia-pessoa';
import { listasPacote } from '../../application/opcoes-estrutura';
import { avaliarSugestaoConta, type CasoAvaliacaoConta, type OpcoesAvaliacaoConta } from './avaliar';
import casosJson from './sugestao-conta.casos.json';

// Avaliador da sugestão de conta na avaliação genérica de casos de IA (US-062, #403; fila ia.avaliar do
// int, US-019). O Administrador pede na tela /int/ia; o worker roda este avaliador em nome de quem
// pediu, remontado do banco como no revisor: ativa, sem bloqueio, sistema fora de manutenção, sem CC de
// escopo e com a permissão do caso. As listas são as do formulário do pacote com escopo TOTAL (contas
// analíticas ativas sem as vetadas e todos os CCs analíticos ativos), sem a guarda de página. As
// vetadas usam as premissas do exercício mais recente (sem exercício, só as raízes de pessoal). O
// resultado leva só números: nenhum texto dos casos vai para a tela.

const CASO = CASOS_IA_ORC.sugestaoConta;
const PERMISSAO = `${CASO.funcionalidade}:executar`;
// [PROVISÓRIO] O trabalhador do int mostra na tela só a mensagem do ErroIA; esta fica no log pelo nome.
export const MSG_AVALIACAO_SEM_ACESSO = 'Quem pediu a avaliação não pode usar a sugestão de conta da IA.';

export type DepsAvaliadorSugestaoConta = DepsPessoaIA & {
  ia: ServicoIA;
  estrutura: DepsOrc['estrutura'];
  obterPremissasExercicio: typeof obterPremissasExercicio;
  casos: readonly CasoAvaliacaoConta[];
  /** Opções da avaliação (sinal e espera do limite por minuto); injetáveis para os testes. */
  opcoes?: Pick<OpcoesAvaliacaoConta, 'sinal' | 'esperar' | 'tentativas'>;
};

function resolver(d: Partial<DepsAvaliadorSugestaoConta>): DepsAvaliadorSugestaoConta {
  return {
    cliente: d.cliente ?? prisma,
    agora: d.agora ?? (() => new Date()),
    pessoa: d.pessoa ?? FUNCOES_PESSOA_IA,
    ia: d.ia ?? servicoIA,
    estrutura: d.estrutura ?? { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas },
    obterPremissasExercicio: d.obterPremissasExercicio ?? obterPremissasExercicio,
    casos: d.casos ?? (casosJson satisfies readonly CasoAvaliacaoConta[]),
    ...(d.opcoes ? { opcoes: d.opcoes } : {}),
  };
}

export function criarAvaliadorSugestaoConta(depsParciais: Partial<DepsAvaliadorSugestaoConta> = {}): AvaliadorCasoIA {
  return async (pedido) => {
    const deps = resolver(depsParciais);
    const { usuarioId } = pedido;
    // O sinal da avaliação inteira (15 min, do trabalhador do int), quando o pedido o traz.
    const sinalGeral = (pedido as PedidoAvaliacaoIA & { sinal?: AbortSignal }).sinal;
    const quem = await remontarPessoaIA(usuarioId, PERMISSAO, deps);
    if (!quem) throw new ErroDominio('orc.avaliacao_sem_acesso', MSG_AVALIACAO_SEM_ACESSO);
    const c = deps.cliente;
    const [indice, ccs, contas, recente] = await Promise.all([
      deps.estrutura.carregarIndiceEstrutura(c),
      deps.estrutura.listarArvoreCentrosCusto(c),
      deps.estrutura.listarArvoreContas(c),
      c.orcamentoExercicio.findFirst({ orderBy: { ano: 'desc' }, select: { ano: true } }),
    ]);
    const premissas = recente ? await deps.obterPremissasExercicio(c, recente.ano) : null;
    const listas = listasPacote(indice, { ccs, contas }, premissas);
    const r = await avaliarSugestaoConta(deps.ia, quem, deps.casos, { ...listas, ...deps.opcoes, ...(sinalGeral ? { sinalGeral } : {}) });
    return { total: r.total, acertos: r.acertosTop3, resumo: { errosIa: r.errosIa, taxa: r.taxa } };
  };
}

/** O avaliador registrado no worker (worker/index.ts), com as dependências padrão. */
export const avaliadorSugestaoConta: AvaliadorCasoIA = criarAvaliadorSugestaoConta();
