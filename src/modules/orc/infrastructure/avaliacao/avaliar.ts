import { ErroIA, type QuemPedeIA, type ServicoIA } from '@/shared/ia';
import { consultarSugestaoConta, type ListasSugestao } from '../../application/ia-sugestao-conta';

// Avaliação da sugestão de conta antes de ligar o caso (US-062; plano do P14, D-P14-9): para cada caso
// sintético, a mesma consulta e a mesma conferência do caso de uso; acerto quando a conta esperada está
// entre as (até 3) contas válidas devolvidas. Critério para ligar: 80 % no top-3 [PROVISÓRIO], medido
// em hml por um job próprio (issue da frente A). Aqui não há banco nem tela: quem roda passa o serviço,
// quem pede e as listas (as mesmas de opcoesPacote).

export type CasoAvaliacaoConta = { descricao: string; contaEsperada: string };
export type ResultadoAvaliacaoConta = { total: number; acertosTop3: number; taxa: number };
export type OpcoesAvaliacaoConta = ListasSugestao & { sinal?: () => AbortSignal };

// Sem resposta aproveitável neste caso (fora do formato, IA fora do ar depois das novas tentativas):
// conta como erro da IA. Os demais (desligada, sem permissão, teto, credencial) invalidam a medição.
const ERROS_DO_CASO: ReadonlySet<string> = new Set(['ia.saida_invalida', 'ia.indisponivel', 'ia.recusa', 'ia.limite_tokens']);

export async function avaliarSugestaoConta(
  servico: ServicoIA,
  quem: QuemPedeIA,
  casos: readonly CasoAvaliacaoConta[],
  opcoes: OpcoesAvaliacaoConta,
): Promise<ResultadoAvaliacaoConta> {
  let acertosTop3 = 0;
  // Um caso por vez: respeita o limite por minuto e o teto da governança.
  for (const caso of casos) {
    try {
      const s = await consultarSugestaoConta(servico, quem, caso.descricao, opcoes, opcoes.sinal?.());
      if (s.contas.some((c) => c.conta === caso.contaEsperada)) acertosTop3++;
    } catch (x) {
      if (!(x instanceof ErroIA) || !ERROS_DO_CASO.has(x.codigo)) throw x;
    }
  }
  const total = casos.length;
  // Razão de contagens, não dinheiro: number serve.
  return { total, acertosTop3, taxa: total === 0 ? 0 : acertosTop3 / total };
}
