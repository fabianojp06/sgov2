import { z } from 'zod';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA } from '@/shared/ia';
import { falha, ok, type Resultado } from '@/shared/kernel';
import { semMarcas } from '../domain/texto';
import { valorParaTela } from '../domain/valor-tela';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { mesOxr } from './grade-oxr';
import { obterPrevisaoFechamento, type ContaPrevista, type TelaPrevisao } from './previsao-fechamento';

// Destaque da IA na previsão de fechamento (US-091; IA-10 da spec §6.8; plano do P34, D-P34-3). Só leitura: o motor
// calcula (domain/previsao.ts) e a IA só redige o destaque das contas em risco. O mês do estouro e os valores de cada
// destaque vêm do motor, nunca da resposta da IA: o destaque de conta que não está na lista é descartado.
//
// Minimização (spec §4.4): a mensagem leva só as contas em risco (classificação, descrição do plano e os números do
// motor), o número do TP e o ano. Nunca nomes de pessoas nem o objeto do TP.

const CASO = CASOS_IA_ORC.previsao;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const MAXIMO_CONTAS = 15;

export type DestaquePrevisao = { conta: string; descricao: string; mesEstouro: string; desvio: string; motivo: string };
export type SugestaoPrevisao = { texto: string; destaques: readonly DestaquePrevisao[] };

const ENTRADA = z.object({ proposta: z.string(), ano: z.string().optional() }).strict();
export const RESPOSTA_PREVISAO = z.object({
  texto: z.string().trim().min(10).max(1200),
  destaques: z.array(z.object({ conta: z.string().trim().min(1).max(40), motivo: z.string().trim().min(1).max(300) })).max(10),
});

const erro = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);
export const SEM_RISCO = 'Nenhuma conta tem risco de estouro no ano pela projeção do sistema.';

const linhaConta = (c: ContaPrevista) =>
  [
    `- ${c.conta} (${semMarcas(c.descricao)}):`,
    `orçado do ano R$ ${valorParaTela(c.orcadoAno)};`,
    `realizado até o corte R$ ${valorParaTela(c.realizadoAteCorte)};`,
    `projetado R$ ${valorParaTela(c.projetadoAno)};`,
    `desvio R$ ${valorParaTela(c.desvio)};`,
    `tendência ${c.tendencia ? c.tendencia.formatar() : 'sem orçado acumulado'};`,
    `estouro em ${c.mesEstouro ? mesOxr(c.mesEstouro) : '—'}.`,
  ].join(' ');

export function montarMensagemPrevisao(t: TelaPrevisao, emRisco: readonly ContaPrevista[]): string {
  return [
    `Termo de Parceria ${t.numero}, ano ${t.ano}.`,
    t.mesCorte ? `Realizado carregado até ${mesOxr(t.mesCorte)}.` : 'Ainda não há realizado no ano: a projeção é o orçado.',
    `Total do ano: orçado R$ ${valorParaTela(t.total.orcadoAno)}; projetado R$ ${valorParaTela(t.total.projetadoAno)}.`,
    ...(t.semPessoal ? ['As contas de pessoal não estão na lista.'] : []),
    'Contas com risco de estouro, da maior para a menor:',
    ...emRisco.map(linhaConta),
  ].join('\n');
}

export async function destacarRiscos(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsIaOrc> = {}): Promise<Resultado<SugestaoPrevisao>> {
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  const deps = resolverDepsIa(depsParciais);
  const parse = ENTRADA.safeParse(bruto);
  if (!parse.success) return erro('Dados da previsão inválidos. Recarregue a tela.');
  // A previsão com a permissão e a RLS de quem pede (orc.oxr:consultar).
  const r = await obterPrevisaoFechamento(ctx, parse.data, deps);
  if (!r.tela) return erro(r.erro ?? 'Selecione um Termo de Parceria para consultar.');
  const emRisco = r.tela.contas.filter((c) => c.risco).slice(0, MAXIMO_CONTAS);
  if (emRisco.length === 0) return ok({ texto: SEM_RISCO, destaques: [] });
  const sinal = deps.sinalIa();
  try {
    const { valor } = await deps.ia.gerarEstruturado(ctx, CASO, montarMensagemPrevisao(r.tela, emRisco), RESPOSTA_PREVISAO, sinal);
    const porConta = new Map(emRisco.map((c) => [c.conta, c]));
    const vistos = new Set<string>();
    const destaques = valor.destaques.flatMap((d): DestaquePrevisao[] => {
      const c = porConta.get(d.conta.trim());
      if (!c || !c.mesEstouro || vistos.has(c.conta)) return [];
      vistos.add(c.conta);
      return [{ conta: c.conta, descricao: c.descricao, mesEstouro: c.mesEstouro, desvio: valorParaTela(c.desvio), motivo: d.motivo }];
    });
    return ok({ texto: valor.texto, destaques });
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(mensagemErroIA(x, sinal));
  }
}
