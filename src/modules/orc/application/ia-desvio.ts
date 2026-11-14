import { z } from 'zod';
import type { ContextoRequisicao } from '@/shared/authz';
import { ErroIA } from '@/shared/ia';
import { Dinheiro, falha, ok, Percentual, type Resultado } from '@/shared/kernel';
import { semMarcas } from '../domain/texto';
import { valorParaTela } from '../domain/valor-tela';
import { mesOxr, type LinhaOxr } from './grade-oxr';
import { CASOS_IA_ORC } from './ia-casos';
import { mensagemErroIA, resolverDepsIa, type DepsIaOrc } from './ia-deps';
import { montarOrcadoRealizado, type TelaOxr } from './orcado-realizado';

// Explicação do desvio orçado x realizado (US-090; IA-09 da spec §6.8; plano do P35). Só leitura. O sistema monta os
// fatos (o total do período, as contas com maior desvio, as que compensaram, os meses que mais pesaram, os ajustes de
// meses fechados e as pendências) a partir da tela do Orçado x Realizado, com a mesma permissão, RLS e regra do
// pessoal; a IA só redige. "Números das ferramentas, não da IA" (critério da #112): todo número do texto precisa estar
// na mensagem que o sistema montou; senão, a resposta é recusada [D-P35-2]. As contas e os meses citados que não
// estão nos fatos são descartados.
//
// Minimização (spec §4.4): o número do TP, o período e os números; nunca o objeto do TP nem nomes de pessoas.

const CASO = CASOS_IA_ORC.desvio;
const PERMISSAO_IA = `${CASO.funcionalidade}:executar`;
const MAXIMO_CONTAS = 8;
const MAXIMO_MESES = 3;

export type ExplicacaoDesvio = { texto: string; contas: readonly string[]; meses: readonly string[] };

const ENTRADA = z
  .object({ proposta: z.string(), de: z.string().optional(), ate: z.string().optional(), conta: z.string().optional(), zeradas: z.boolean().optional() })
  .strict();
export const RESPOSTA_DESVIO = z.object({
  texto: z.string().trim().min(30).max(1500),
  contas: z.array(z.string().trim().min(1).max(40)).max(10),
  meses: z.array(z.string().trim().min(1).max(10)).max(12),
});

const erro = (mensagem: string): Resultado<never> => falha([{ campo: '_', mensagem }]);
export const SEM_DESVIO = 'O realizado do período está igual ao orçado: não há desvio a explicar.';
export const NUMERO_INVENTADO = 'A explicação da IA trouxe um número que não veio do sistema e foi descartada. Peça de novo.';

const uso = (orcado: Dinheiro, realizado: Dinheiro) => {
  const p = Percentual.razao(realizado, orcado);
  return p ? p.formatar() : 'sem orçamento';
};
const desvioDe = (l: LinhaOxr) => l.periodo.realizado.subtrair(l.periodo.orcado);
const linhaConta = (l: LinhaOxr) =>
  `- ${l.conta} (${semMarcas(l.descricao).replace(/\s+/g, ' ').trim()}): orçado R$ ${valorParaTela(l.periodo.orcado)}; realizado R$ ${valorParaTela(l.periodo.realizado)}; desvio R$ ${valorParaTela(desvioDe(l))}; uso ${uso(l.periodo.orcado, l.periodo.realizado)}.`;

/** Os fatos da mensagem, só das analíticas: as que mais estouraram, as que compensaram e os meses que mais pesaram. */
export function montarMensagemDesvio(t: TelaOxr): { mensagem: string; contas: ReadonlySet<string>; meses: ReadonlySet<string> } {
  const analiticas = t.grade.linhas.filter((l) => l.analitica && !desvioDe(l).ehZero());
  const acima = analiticas.filter((l) => !desvioDe(l).ehNegativo()).sort((a, b) => desvioDe(b).comparar(desvioDe(a))).slice(0, MAXIMO_CONTAS);
  const abaixo = analiticas.filter((l) => desvioDe(l).ehNegativo()).sort((a, b) => desvioDe(a).comparar(desvioDe(b))).slice(0, MAXIMO_CONTAS);
  const porMes = t.meses
    .map((m, i) => ({ mes: m, c: t.grade.total.meses[i]! }))
    .map((x) => ({ ...x, desvio: x.c.realizado.subtrair(x.c.orcado) }))
    .filter((x) => !x.desvio.ehZero())
    .sort((a, b) => b.desvio.paraDecimal().abs().comparedTo(a.desvio.paraDecimal().abs()))
    .slice(0, MAXIMO_MESES);
  const p = t.grade.total.periodo;
  const mensagem = [
    `Termo de Parceria ${t.numero}, de ${mesOxr(t.filtros.de)} a ${mesOxr(t.filtros.ate)}${t.filtros.conta ? `, conta ${t.filtros.conta}` : ''}.`,
    `Total do período: orçado R$ ${valorParaTela(p.orcado)}; realizado R$ ${valorParaTela(p.realizado)}; saldo R$ ${valorParaTela(p.saldo)}; uso ${uso(p.orcado, p.realizado)}.`,
    ...(t.semPessoal || t.pessoalNaoHomologado ? ['As contas de pessoal não estão nos números.'] : []),
    'Contas com realizado acima do orçado:',
    ...(acima.length > 0 ? acima.map(linhaConta) : ['- nenhuma.']),
    'Contas com realizado abaixo do orçado (compensaram):',
    ...(abaixo.length > 0 ? abaixo.map(linhaConta) : ['- nenhuma.']),
    'Meses que mais pesaram no desvio:',
    ...(porMes.length > 0
      ? porMes.map((x) => `- ${mesOxr(x.mes)}: orçado R$ ${valorParaTela(x.c.orcado)}; realizado R$ ${valorParaTela(x.c.realizado)}; desvio R$ ${valorParaTela(x.desvio)}.`)
      : ['- nenhum.']),
    'Ajustes de meses fechados lançados no período:',
    ...(t.ajustes.length > 0
      ? t.ajustes.map((a) => `- ${a.conta}: R$ ${valorParaTela(a.valor)}, de ${mesOxr(a.origem)} lançado em ${mesOxr(a.lancamento)}.`)
      : ['- nenhum.']),
    t.pendencias.quantidade > 0
      ? `Pendências do ERP sem conta no SGO: ${t.pendencias.quantidade}, R$ ${valorParaTela(t.pendencias.valor)}, fora dos números.`
      : 'Sem pendências do ERP.',
  ].join('\n');
  return {
    mensagem,
    contas: new Set([...acima, ...abaixo].map((l) => l.conta).concat(t.ajustes.map((a) => a.conta))),
    meses: new Set([...porMes.map((x) => mesOxr(x.mes)), ...t.ajustes.flatMap((a) => [mesOxr(a.origem), mesOxr(a.lancamento)])]),
  };
}

/** D-P35-2: cada número do texto (sequência de dígitos com ponto, vírgula ou barra) precisa aparecer na mensagem. */
export function numerosForaDaMensagem(texto: string, mensagem: string): string[] {
  return [...new Set(texto.match(/\d+(?:[.,/]\d+)*/g) ?? [])].filter((n) => !mensagem.includes(n));
}

export async function explicarDesvio(ctx: ContextoRequisicao, bruto: unknown, depsParciais: Partial<DepsIaOrc> = {}): Promise<Resultado<ExplicacaoDesvio>> {
  if (!ctx.permissoes.has(PERMISSAO_IA)) return erro(new ErroIA('ia.sem_permissao').message);
  const deps = resolverDepsIa(depsParciais);
  const parse = ENTRADA.safeParse(bruto);
  if (!parse.success) return erro('Dados da consulta inválidos. Recarregue a tela.');
  // A tela com a permissão (orc.oxr:consultar), a RLS e a regra do pessoal de quem pede, sem outra CONSULTA.
  const r = await montarOrcadoRealizado(ctx, parse.data, deps, false);
  if (!r.tela) return erro(r.erro ?? 'Selecione um Termo de Parceria para consultar.');
  const fatos = montarMensagemDesvio(r.tela);
  if (fatos.contas.size === 0) return ok({ texto: SEM_DESVIO, contas: [], meses: [] });
  const sinal = deps.sinalIa();
  try {
    const { valor } = await deps.ia.gerarEstruturado(ctx, CASO, fatos.mensagem, RESPOSTA_DESVIO, sinal);
    if (numerosForaDaMensagem(valor.texto, fatos.mensagem).length > 0) return erro(NUMERO_INVENTADO);
    return ok({
      texto: valor.texto,
      contas: [...new Set(valor.contas.map((c) => c.trim()))].filter((c) => fatos.contas.has(c)),
      meses: [...new Set(valor.meses.map((m) => m.trim()))].filter((m) => fatos.meses.has(m)),
    });
  } catch (x) {
    if (!(x instanceof ErroIA)) throw x;
    return erro(mensagemErroIA(x, sinal));
  }
}
