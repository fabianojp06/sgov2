import { ErroIA, type CodigoErroIA, type QuemPedeIA, type ServicoIA } from '@/shared/ia';
import { TEMPO_LIMITE_IA_MS, tempoEsgotado } from '../../application/ia-erros';
import { consultarSugestaoConta, type ListasSugestao } from '../../application/ia-sugestao-conta-consulta';

// Avaliação da sugestão de conta antes de ligar o caso (US-062; plano do P14, D-P14-9): para cada caso
// sintético, a mesma consulta e a mesma conferência do caso de uso; acerto quando a conta esperada está
// entre as (até 3) contas válidas devolvidas. Critério para ligar: 80 % no top-3 [PROVISÓRIO], medido
// em hml pela fila ia.avaliar (avaliador.ts, #403). Aqui não há banco nem tela: quem roda passa o
// serviço, quem pede e as listas (as mesmas de opcoesPacote).

export type CasoAvaliacaoConta = { descricao: string; contaEsperada: string };
/** errosIa: casos sem resposta aproveitável (contam no total, nunca como acerto). */
export type ResultadoAvaliacaoConta = { total: number; acertosTop3: number; errosIa: number; taxa: number };
export type OpcoesAvaliacaoConta = ListasSugestao & {
  /** Sinal de cada caso; padrão: o tempo limite da chamada interativa (30 s), novo a cada tentativa. */
  sinal?: () => AbortSignal;
  /** Espera antes de repetir um caso recusado pelo limite por minuto; injetável para os testes. */
  esperar?: (ms: number) => Promise<void>;
  /** Tentativas de cada caso diante do limite por minuto (padrão 3). */
  tentativas?: number;
  /**
   * Sinal da avaliação inteira (o do pedido da fila ia.avaliar): combinado com o de cada caso. Abortado,
   * a avaliação para com ErroIA('ia.cancelada'), sem contar os casos que faltam como erro da IA.
   */
  sinalGeral?: AbortSignal;
};

// O limite por minuto da governança conta a janela do último minuto: espera um minuto inteiro.
export const ESPERA_LIMITE_USUARIO_MS = 60_000;
const TENTATIVAS_PADRAO = 3;
// Sem resposta aproveitável neste caso (fora do formato, IA fora do ar depois das novas tentativas,
// recusa, resposta cortada): erro daquele caso. Os demais (desligada, sem permissão, teto, credencial,
// cancelamento que não veio do tempo limite) invalidam a medição e sobem.
const ERROS_DO_CASO: ReadonlySet<CodigoErroIA> = new Set(['ia.saida_invalida', 'ia.indisponivel', 'ia.recusa', 'ia.limite_tokens']);
const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function avaliarSugestaoConta(
  servico: ServicoIA,
  quem: QuemPedeIA,
  casos: readonly CasoAvaliacaoConta[],
  opcoes: OpcoesAvaliacaoConta,
): Promise<ResultadoAvaliacaoConta> {
  const novoSinal = opcoes.sinal ?? (() => AbortSignal.timeout(TEMPO_LIMITE_IA_MS));
  const esperar = opcoes.esperar ?? esperarPadrao;
  const tentativas = Math.max(1, opcoes.tentativas ?? TENTATIVAS_PADRAO);
  const geral = opcoes.sinalGeral;
  const pararSeCancelada = () => {
    if (geral?.aborted) throw new ErroIA('ia.cancelada');
  };
  let acertosTop3 = 0;
  let errosIa = 0;
  // Um caso por vez, sem pedidos em paralelo. Quando o limite por minuto recusa, espera e repete o
  // mesmo caso, até o máximo de tentativas; esgotadas, o caso conta como erro da IA.
  for (const caso of casos) {
    for (let tentativa = 1; ; tentativa++) {
      pararSeCancelada();
      const sinalCaso = novoSinal();
      const sinal = geral ? AbortSignal.any([geral, sinalCaso]) : sinalCaso;
      try {
        const s = await consultarSugestaoConta(servico, quem, caso.descricao, opcoes, sinal);
        if (s.contas.some((c) => c.conta === caso.contaEsperada)) acertosTop3++;
        break;
      } catch (x) {
        if (!(x instanceof ErroIA)) throw x;
        pararSeCancelada();
        if (x.codigo === 'ia.limite_usuario' && tentativa < tentativas) {
          await esperar(ESPERA_LIMITE_USUARIO_MS);
          continue;
        }
        const doCaso = ERROS_DO_CASO.has(x.codigo) || x.codigo === 'ia.limite_usuario' || (x.codigo === 'ia.cancelada' && tempoEsgotado(sinalCaso));
        if (!doCaso) throw x;
        errosIa++;
        break;
      }
    }
  }
  const total = casos.length;
  // Razão de contagens, não dinheiro: number serve.
  return { total, acertosTop3, errosIa, taxa: total === 0 ? 0 : acertosTop3 / total };
}
