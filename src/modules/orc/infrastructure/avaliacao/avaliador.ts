import { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas, obterPremissasExercicio } from '@/modules/cad/servidor';
import { prisma } from '@/shared/db';
import { ErroIA, servicoIA, type AvaliadorCasoIA, type ServicoIA } from '@/shared/ia';
import { estruturaDaAdmCentral } from '../../application/adm-central';
import type { DepsOrc } from '../../application/deps';
import { CASOS_IA_ORC } from '../../application/ia-casos';
import { FUNCOES_PESSOA_IA, remontarPessoaIA, type DepsPessoaIA } from '../../application/ia-pessoa';
import { listasPacote } from '../../application/opcoes-estrutura';
import { avaliarSugestaoConta, type CasoAvaliacaoConta, type OpcoesAvaliacaoConta } from './avaliar';
import casosJson from './sugestao-conta.casos.json';

// Avaliador da sugestão de conta na avaliação genérica de casos de IA (US-062, #403; fila ia.avaliar do
// int, US-019). O Administrador pede na tela /int/ia; o worker roda este avaliador em nome de quem
// pediu, remontado do banco como no revisor: ativa, sem bloqueio, sistema fora de manutenção, sem CC de
// escopo e com a permissão do caso (o ADMINISTRADOR a tem pela seed). Uma execução só por avaliação. As listas são as do formulário do pacote com escopo TOTAL (contas
// analíticas ativas sem as vetadas e todos os CCs analíticos ativos), sem a guarda de página. As
// vetadas usam as premissas do maior ano que as tem (premissasMaisRecentes). O resultado leva só
// números: nenhum texto dos casos vai para a tela.

const CASO = CASOS_IA_ORC.sugestaoConta;
const PERMISSAO = `${CASO.funcionalidade}:executar`;

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
    // Como na sugestão (deps do orc): só os CCs da Adm. Central, raiz 4 (C37).
    estrutura: estruturaDaAdmCentral(d.estrutura ?? { carregarIndiceEstrutura, listarArvoreCentrosCusto, listarArvoreContas }),
    obterPremissasExercicio: d.obterPremissasExercicio ?? obterPremissasExercicio,
    casos: d.casos ?? (casosJson satisfies readonly CasoAvaliacaoConta[]),
    ...(d.opcoes ? { opcoes: d.opcoes } : {}),
  };
}

/**
 * Premissas das contas vetadas: as do maior ano que tem premissas, do maior para o menor. Um exercício
 * novo ainda sem premissas não esconde as do anterior. Sem nenhum ano com premissas: null, e ficam
 * vetadas só as raízes de pessoal (contasVetadasEmPacote).
 */
async function premissasMaisRecentes(deps: DepsAvaliadorSugestaoConta, exercicios: readonly { ano: number }[]) {
  for (const { ano } of exercicios) {
    const p = await deps.obterPremissasExercicio(deps.cliente, ano);
    if (p) return p;
  }
  return null;
}

export function criarAvaliadorSugestaoConta(depsParciais: Partial<DepsAvaliadorSugestaoConta> = {}): AvaliadorCasoIA {
  // sinal: o da avaliação inteira (15 min, do trabalhador do int), combinado com o de cada caso.
  return async ({ usuarioId, sinal }) => {
    const deps = resolver(depsParciais);
    const pessoa = await remontarPessoaIA(usuarioId, PERMISSAO, deps);
    // ErroIA: o trabalhador do int mostra a mensagem fixa dele na tela (repetir não adianta), sem dado pessoal.
    if (!pessoa) throw new ErroIA('ia.sem_permissao');
    // Muitas chamadas seguidas da mesma pessoa: fora do limite por minuto (permissão, chaves, teto e
    // registro continuam). A marca só vale em infrastructure/ e no worker (fronteira da IA).
    const quem = { ...pessoa, isentoLimitePorMinuto: true as const };
    const c = deps.cliente;
    const [indice, ccs, contas, exercicios] = await Promise.all([
      deps.estrutura.carregarIndiceEstrutura(c),
      deps.estrutura.listarArvoreCentrosCusto(c),
      deps.estrutura.listarArvoreContas(c),
      c.orcamentoExercicio.findMany({ orderBy: { ano: 'desc' }, select: { ano: true } }),
    ]);
    const listas = listasPacote(indice, { ccs, contas }, await premissasMaisRecentes(deps, exercicios));
    const oferecidas = new Set(listas.contas.map((x) => x.classificacao));
    // Casos que não podem acertar: a conta esperada não está na lista oferecida (vetada, inativa ou fora
    // do plano). Ficam no total e aparecem no resumo, para a taxa ser lida com eles à vista.
    const foraDaLista = deps.casos.filter((x) => !oferecidas.has(x.contaEsperada)).length;
    // Sem conta oferecida (plano de contas ainda não carregado), nenhum caso pode acertar: não chama a IA.
    if (listas.contas.length === 0) return { total: deps.casos.length, acertos: 0, resumo: { errosIa: 0, taxa: 0, foraDaLista } };
    const r = await avaliarSugestaoConta(deps.ia, quem, deps.casos, { ...listas, ...deps.opcoes, sinalGeral: sinal });
    return { total: r.total, acertos: r.acertosTop3, resumo: { errosIa: r.errosIa, taxa: r.taxa, foraDaLista } };
  };
}

/** O avaliador registrado no worker (worker/index.ts), com as dependências padrão. */
export const avaliadorSugestaoConta: AvaliadorCasoIA = criarAvaliadorSugestaoConta();
